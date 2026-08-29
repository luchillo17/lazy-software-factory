import {
  AdwWorkerCapability,
  AdwWorkerIsolation,
  AdwWorkerResourceLimitKind,
  AdwWorkerSupportLevel,
  type AdwWorkerEffectiveCapabilities,
  type AdwWorkerProgressEvent,
  type AdwWorkerRequest,
  type AdwWorkerResourceLimits,
} from "@lazy-software-factory/adw-worker";
import { NodeCrypto } from "@effect/platform-node";
import { Cause, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { Crypto } from "effect/Crypto";
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner";
import {
  DOCKER_WORKSPACE_PATH,
  dockerCreateArgs,
  dockerExecInteractiveArgs,
  dockerKillArgs,
  dockerRmArgs,
  dockerStartArgs,
  dockerVolumeCreateArgs,
  dockerVolumeRmArgs,
} from "./docker-argv.ts";
import {
  DockerCli,
  dockerCliToCreateError,
  requireDockerOk,
} from "./docker-cli.ts";
import {
  RuntimeErrorTag,
  SandboxBusyError,
  SandboxCreateError,
  SandboxDestroyError,
  SandboxExecError,
  SandboxWorkerError,
} from "./errors.ts";
import { runWorkerProtocolProcess } from "./host-worker-runner.ts";
import { runDockerWorkerHandshake } from "./docker-worker-runner.ts";
import {
  resolveEffectiveCapabilities,
  type BackendCapabilityProfile,
} from "./sandbox-capabilities.ts";
import type {
  AcquireSandboxError,
  AcquireSandboxOptions,
  SandboxLease,
} from "./sandbox-lease.ts";
import type {
  CreateSandboxOptions,
  ExecResult,
  Sandbox,
  SandboxExecOptions,
} from "./sandbox.ts";
import { SandboxProvider } from "./sandbox-provider.ts";

const dockerEnforceableLimits = new Set([
  AdwWorkerResourceLimitKind.Cpu,
  AdwWorkerResourceLimitKind.Memory,
  AdwWorkerResourceLimitKind.Pid,
  AdwWorkerResourceLimitKind.Lifetime,
]);

const dockerProfile = (
  maxConcurrentLeases: number,
  defaultLimits?: AdwWorkerResourceLimits
): BackendCapabilityProfile => ({
  capabilities: [
    AdwWorkerCapability.CursorLocalAgent,
    AdwWorkerCapability.GitHostCli,
    AdwWorkerCapability.WorkspaceExec,
    AdwWorkerCapability.SkillPackMount,
  ],
  maxConcurrentLeases,
  isolation: AdwWorkerIsolation.Container,
  retainedWorkspaces: AdwWorkerSupportLevel.Unsupported,
  diskQuota: AdwWorkerSupportLevel.Unsupported,
  enforceableLimits: dockerEnforceableLimits,
  ...(defaultLimits ? { defaultLimits } : {}),
});

/** Reject Host-style cwd / bind-mount intake for Docker leases. */
export const rejectDockerHostSourceIntake = (
  options?: CreateSandboxOptions
): Effect.Effect<void, SandboxCreateError> => {
  if (options?.cwd !== undefined && options.cwd !== DOCKER_WORKSPACE_PATH) {
    return Effect.fail(
      new SandboxCreateError({
        message:
          "Docker sandbox rejects local cwd / dirty-tree bind mounts; pass a remote Git repoUrl (and optional startingRef) instead",
      })
    );
  }
  if (options?.image !== undefined) {
    return Effect.fail(
      new SandboxCreateError({
        message:
          "Docker image is configured on the SandboxProvider Layer, not on ADW request / acquire options",
      })
    );
  }
  return Effect.void;
};

export interface DockerSandboxOptions {
  /** Runner image reference (tag or name@digest). */
  readonly image: string;
  /** Absolute path to compiled worker entry inside the image. */
  readonly workerCommand?: string;
  readonly workerArgs?: readonly string[];
  /** Docker CLI binary (default `docker`). */
  readonly dockerCommand?: string;
  /** Optional Docker context name. */
  readonly context?: string;
  /** Soft allocation ceiling; exhausted → SandboxBusyError (no internal queue). */
  readonly maxConcurrentLeases?: number;
  readonly terminateGrace?: `${number} seconds` | `${number} millis`;
  /** Non-secret container env (e.g. isolation marker, integration stubs). */
  readonly containerEnv?: Readonly<Record<string, string>>;
  readonly tmpSize?: string;
  readonly cacheSize?: string;
  readonly user?: string;
  /** Default resource limits applied when acquire omits hard/soft limits. */
  readonly defaultLimits?: AdwWorkerResourceLimits;
}

type DockerBox = {
  readonly id: string;
  readonly containerName: string;
  readonly volumeName: string;
  readonly cwd: typeof DOCKER_WORKSPACE_PATH;
  readonly children: Set<ChildProcessHandle>;
  readonly destroy: () => Effect.Effect<void, SandboxDestroyError>;
  readonly finalize: () => Effect.Effect<void>;
};

const defaultWorkerCommand = "node";
const defaultWorkerArgs = ["/opt/factory/adw-worker.mjs"] as const;

const stopTimeoutSecondsFromGrace = (
  grace: `${number} seconds` | `${number} millis` | undefined
): number | undefined => {
  if (!grace) {
    return undefined;
  }
  if (grace.endsWith("millis")) {
    return Math.max(1, Math.ceil(Number.parseInt(grace, 10) / 1000));
  }
  return Number.parseInt(grace, 10);
};

/**
 * Classic Docker SandboxProvider Layer: one hardened container + ephemeral
 * named volume per lease; worker protocol via `docker exec -i`.
 *
 * Docker daemon/context/image live here — not on ADW request types.
 * Requires {@link DockerCli} + {@link Crypto}; use
 * {@link dockerSandboxProviderLayer} for the live CLI wiring.
 */
export const makeDockerSandboxProviderLayer = (config: DockerSandboxOptions) =>
  Layer.effect(
    SandboxProvider,
    Effect.gen(function* () {
      const crypto = yield* Crypto;
      const docker = yield* DockerCli;
      const maxConcurrent = config.maxConcurrentLeases ?? 32;
      const profile = dockerProfile(maxConcurrent, config.defaultLimits);
      const active = new Set<string>();

      const cleanupStep = (
        args: readonly string[],
        label: string,
        absentPattern: RegExp
      ): Effect.Effect<void, SandboxDestroyError> =>
        docker.run({ args }).pipe(
          Effect.mapError(
            (cause) =>
              new SandboxDestroyError({
                message: `${label} could not start`,
                cause,
              })
          ),
          Effect.flatMap((result) => {
            if (
              result.exitCode === 0 ||
              absentPattern.test(`${result.stderr}\n${result.stdout}`)
            ) {
              return Effect.void;
            }
            return Effect.fail(
              new SandboxDestroyError({
                message: `${label} failed (exit ${result.exitCode}): ${
                  result.stderr.trim() || result.stdout.trim() || "no output"
                }`,
              })
            );
          })
        );

      const releaseResources = (box: {
        readonly id: string;
        readonly containerName: string;
        readonly volumeName: string;
      }): Effect.Effect<void, SandboxDestroyError> =>
        Effect.gen(function* () {
          yield* docker
            .run({ args: dockerKillArgs(box.containerName) })
            .pipe(Effect.catch(() => Effect.void));

          const containerExit = yield* cleanupStep(
            dockerRmArgs(box.containerName),
            "docker container cleanup",
            /no such container/i
          ).pipe(Effect.exit);
          const volumeExit = yield* cleanupStep(
            dockerVolumeRmArgs(box.volumeName),
            "docker volume cleanup",
            /no such volume|not found/i
          ).pipe(Effect.exit);

          if (Exit.isFailure(containerExit) || Exit.isFailure(volumeExit)) {
            const causes = [
              ...(Exit.isFailure(containerExit)
                ? [Cause.squash(containerExit.cause)]
                : []),
              ...(Exit.isFailure(volumeExit)
                ? [Cause.squash(volumeExit.cause)]
                : []),
            ];
            return yield* new SandboxDestroyError({
              message: causes.map(String).join("; "),
              cause: causes,
            });
          }
          active.delete(box.id);
        });

      const allocate = (
        options: CreateSandboxOptions | undefined,
        effective: AdwWorkerEffectiveCapabilities
      ): Effect.Effect<
        DockerBox,
        SandboxCreateError | SandboxBusyError,
        Scope.Scope
      > =>
        Effect.acquireRelease(
          Effect.gen(function* () {
            yield* rejectDockerHostSourceIntake(options);

            if (active.size >= maxConcurrent) {
              return yield* new SandboxBusyError({
                message: `Docker sandbox capacity exhausted (max ${maxConcurrent})`,
              });
            }

            const id = yield* crypto.randomUUIDv4.pipe(
              Effect.mapError(
                (cause) =>
                  new SandboxCreateError({
                    message: "Failed to allocate Docker sandbox id",
                    cause,
                  })
              )
            );
            const short = id.replaceAll("-", "").slice(0, 12);
            const containerName = `lsf-adw-${short}`;
            const volumeName = `lsf-adw-ws-${short}`;

            active.add(id);

            const failAllocate = (
              err: SandboxCreateError
            ): Effect.Effect<never, SandboxCreateError> =>
              releaseResources({ id, containerName, volumeName }).pipe(
                Effect.mapError(
                  (cleanupError) =>
                    new SandboxCreateError({
                      message: `${err.message}; cleanup failed: ${cleanupError.message}`,
                      cause: cleanupError,
                    })
                ),
                Effect.andThen(Effect.fail(err))
              );

            const dockerStep = (
              args: readonly string[],
              label: string
            ): Effect.Effect<void, SandboxCreateError> =>
              docker.run({ args }).pipe(
                Effect.mapError(dockerCliToCreateError),
                Effect.flatMap((r) =>
                  requireDockerOk(r, label).pipe(
                    Effect.mapError(dockerCliToCreateError)
                  )
                ),
                Effect.asVoid,
                Effect.catch((err) =>
                  failAllocate(
                    err instanceof SandboxCreateError
                      ? err
                      : dockerCliToCreateError(err as never)
                  )
                )
              );

            yield* dockerStep(
              dockerVolumeCreateArgs(volumeName),
              "docker volume create"
            );

            const limits = effective.limits;
            const stopTimeoutSeconds = stopTimeoutSecondsFromGrace(
              config.terminateGrace
            );
            const createArgs = dockerCreateArgs({
              name: containerName,
              image: config.image,
              mounts: {
                workspaceVolume: volumeName,
                tmpSize: config.tmpSize,
                cacheSize: config.cacheSize,
              },
              user: config.user,
              env: {
                ADW_SANDBOX_ISOLATION: "container",
                ADW_HOST_SKILL_PACK_ROOT: "/opt/factory/host-skill-pack",
                HOME: "/home/adw",
                npm_config_cache: `${DOCKER_WORKSPACE_PATH}/.npm-cache`,
                npm_config_store_dir: "/home/adw/.cache/pnpm-store",
                XDG_CACHE_HOME: "/home/adw/.cache",
                ...config.containerEnv,
              },
              limits: {
                ...(limits?.cpu !== undefined ? { cpu: limits.cpu } : {}),
                ...(limits?.memoryBytes !== undefined
                  ? { memoryBytes: limits.memoryBytes }
                  : {}),
                ...(limits?.pidsLimit !== undefined
                  ? { pidsLimit: limits.pidsLimit }
                  : {}),
                ...(stopTimeoutSeconds !== undefined
                  ? { stopTimeoutSeconds }
                  : {}),
              },
            });

            yield* dockerStep(createArgs, "docker create");
            yield* dockerStep(dockerStartArgs(containerName), "docker start");

            const children = new Set<ChildProcessHandle>();
            const cleanup = yield* Effect.cached(
              Effect.uninterruptibleMask((restore) =>
                Effect.gen(function* () {
                  const pending = [...children];
                  for (const handle of pending) {
                    yield* handle
                      .kill({ killSignal: "SIGTERM" })
                      .pipe(Effect.catch(() => Effect.void));
                  }
                  yield* restore(
                    Effect.forEach(
                      pending,
                      (handle) =>
                        handle.exitCode.pipe(
                          Effect.asVoid,
                          Effect.timeout("5 seconds"),
                          Effect.catchTag("TimeoutError", () =>
                            handle
                              .kill({ killSignal: "SIGKILL" })
                              .pipe(Effect.catch(() => Effect.void))
                          ),
                          Effect.catch(() => Effect.void)
                        ),
                      { concurrency: "unbounded" }
                    )
                  ).pipe(Effect.exit);
                  children.clear();
                  yield* releaseResources({
                    id,
                    containerName,
                    volumeName,
                  });
                })
              )
            );
            let cleanupObserved = false;
            const destroy = (): Effect.Effect<void, SandboxDestroyError> =>
              Effect.suspend(() => {
                cleanupObserved = true;
                return cleanup;
              });
            const finalize = (): Effect.Effect<void> =>
              Effect.suspend(() =>
                cleanupObserved ? cleanup.pipe(Effect.ignore) : cleanup
              ).pipe(Effect.orDie);

            return {
              id,
              containerName,
              volumeName,
              cwd: DOCKER_WORKSPACE_PATH,
              children,
              destroy,
              finalize,
            } satisfies DockerBox;
          }),
          (box) => box.finalize()
        );

      const create = (options?: CreateSandboxOptions) =>
        Effect.gen(function* () {
          // create has no requirements; resolve cannot fail for the default profile.
          const effective = yield* resolveEffectiveCapabilities(profile).pipe(
            Effect.catchTag(RuntimeErrorTag.SandboxCapabilityError, (err) =>
              Effect.fail(
                new SandboxCreateError({
                  message: err.message,
                })
              )
            )
          );
          const box = yield* allocate(options, effective);
          const exec = (
            execOptions: SandboxExecOptions
          ): Effect.Effect<ExecResult, SandboxExecError> =>
            Effect.gen(function* () {
              const result = yield* docker
                .run({
                  args: dockerExecInteractiveArgs({
                    container: box.containerName,
                    command: execOptions.command,
                    args: execOptions.argv ?? [],
                    workdir: execOptions.cwd ?? DOCKER_WORKSPACE_PATH,
                    user: config.user,
                    env: execOptions.env,
                  }),
                  stdin: execOptions.stdin,
                  timeoutMs: execOptions.timeoutMs,
                })
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new SandboxExecError({
                        message: `Failed to exec in Docker sandbox ${box.id}`,
                        cause,
                      })
                  )
                );
              return {
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
              };
            });

          return {
            id: box.id,
            cwd: box.cwd,
            exec,
            destroy: box.destroy,
          } satisfies Sandbox;
        });

      const acquire = (
        options?: AcquireSandboxOptions
      ): Effect.Effect<SandboxLease, AcquireSandboxError, Scope.Scope> =>
        Effect.gen(function* () {
          // Hard requirements fail before volume/container allocation.
          const effective = yield* resolveEffectiveCapabilities(
            profile,
            options?.requirements
          );
          const box = yield* allocate(options, effective);
          let released = false;
          let workerRan = false;

          const release = (): Effect.Effect<void, SandboxDestroyError> =>
            Effect.suspend(() => {
              released = true;
              return box.destroy();
            });

          // Provider-side lifetime: destroy when the lease exceeds the limit.
          if (effective.limits?.lifetimeMs !== undefined) {
            const lifetimeMs = effective.limits.lifetimeMs;
            const lifetimeFiber = yield* Effect.gen(function* () {
              yield* Effect.sleep(`${lifetimeMs} millis`);
              yield* release();
            }).pipe(Effect.forkScoped);
            yield* Effect.addFinalizer(() =>
              Fiber.interrupt(lifetimeFiber).pipe(Effect.asVoid)
            );
          }

          return {
            id: box.id,
            cwd: box.cwd,
            effectiveCapabilities: effective,
            release,
            runWorker: (
              request: AdwWorkerRequest,
              workerOptions: {
                readonly onProgress: (
                  event: AdwWorkerProgressEvent
                ) => Effect.Effect<void>;
              }
            ) =>
              Effect.gen(function* () {
                if (released) {
                  return yield* new SandboxWorkerError({
                    message: `Sandbox lease ${box.id} is released`,
                  });
                }
                if (workerRan) {
                  return yield* new SandboxWorkerError({
                    message: `Sandbox lease ${box.id} already ran its ADW worker`,
                  });
                }
                workerRan = true;

                const secretFreeRequest: AdwWorkerRequest = {
                  ...request,
                  cwd: DOCKER_WORKSPACE_PATH,
                };

                const launch = {
                  command: config.dockerCommand ?? "docker",
                  args: [
                    ...(config.context
                      ? (["--context", config.context] as const)
                      : []),
                    ...dockerExecInteractiveArgs({
                      container: box.containerName,
                      command: config.workerCommand ?? defaultWorkerCommand,
                      args: config.workerArgs ?? [...defaultWorkerArgs],
                      workdir: DOCKER_WORKSPACE_PATH,
                      user: config.user,
                    }),
                  ],
                };

                // Custom/default images must pass handshake before secrets.
                yield* runDockerWorkerHandshake({
                  launch,
                  terminateGrace: config.terminateGrace,
                });

                return yield* runWorkerProtocolProcess({
                  launch,
                  request: secretFreeRequest,
                  terminateGrace: config.terminateGrace,
                  onProgress: workerOptions.onProgress,
                  onSpawn: (handle) => {
                    box.children.add(handle);
                  },
                  onSettle: (handle) => {
                    box.children.delete(handle);
                  },
                });
              }),
          } satisfies SandboxLease;
        });

      return SandboxProvider.of({ create, acquire });
    })
  );

/** Live Docker provider: Node crypto + installed Docker CLI. */
export const dockerSandboxProviderLayer = (config: DockerSandboxOptions) =>
  makeDockerSandboxProviderLayer(config).pipe(
    Layer.provide(NodeCrypto.layer),
    Layer.provide(
      DockerCli.layer({
        command: config.dockerCommand,
        context: config.context,
      })
    )
  );
