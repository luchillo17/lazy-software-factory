import {
  AdwWorkerCapability,
  AdwWorkerIsolation,
  AdwWorkerSupportLevel,
  defaultMinimalAdwCapabilityRequirements,
  type AdwWorkerCapabilityRequirements,
  type AdwWorkerEffectiveCapabilities,
  type AdwWorkerProgressEvent,
  type AdwWorkerRequest,
} from "@lazy-software-factory/adw-worker";
import { NodeCrypto } from "@effect/platform-node";
import { Effect, Layer, Scope } from "effect";
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
  SandboxBusyError,
  SandboxCapabilityError,
  SandboxCreateError,
  SandboxExecError,
  SandboxWorkerError,
} from "./errors.ts";
import { runWorkerProtocolProcess } from "./host-worker-runner.ts";
import { runDockerWorkerHandshake } from "./docker-worker-runner.ts";
import type {
  AcquireSandboxError,
  AcquireSandboxOptions,
  SandboxLease,
} from "./sandbox-lease.ts";
import type { CreateSandboxOptions, ExecResult, Sandbox } from "./sandbox.ts";
import { SandboxProvider } from "./sandbox-provider.ts";

const dockerCapabilities = (
  maxConcurrentLeases: number
): AdwWorkerEffectiveCapabilities => ({
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
});

const assertCapabilities = (
  requirements: AdwWorkerCapabilityRequirements | undefined,
  effective: AdwWorkerEffectiveCapabilities
): Effect.Effect<void, SandboxCapabilityError> => {
  const hard =
    requirements?.hard ?? defaultMinimalAdwCapabilityRequirements.hard;
  const supported = new Set(effective.capabilities);
  const missing = hard.filter((cap) => !supported.has(cap));
  if (missing.length > 0) {
    return Effect.fail(
      new SandboxCapabilityError({
        message: `Sandbox backend missing required capabilities: ${missing.join(", ")}`,
        missing: [...missing],
      })
    );
  }
  return Effect.void;
};

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
  /** Soft allocation ceiling; exhausted → SandboxBusyError. */
  readonly maxConcurrentLeases?: number;
  readonly terminateGrace?: `${number} seconds` | `${number} millis`;
  /** Non-secret container env (e.g. isolation marker, integration stubs). */
  readonly containerEnv?: Readonly<Record<string, string>>;
  readonly tmpSize?: string;
  readonly cacheSize?: string;
  readonly user?: string;
}

type DockerBox = {
  readonly id: string;
  readonly containerName: string;
  readonly volumeName: string;
  readonly cwd: typeof DOCKER_WORKSPACE_PATH;
  readonly children: Set<ChildProcessHandle>;
  readonly destroy: () => Effect.Effect<void>;
};

const defaultWorkerCommand = "node";
const defaultWorkerArgs = ["/opt/factory/adw-worker.mjs"] as const;

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
      const effective = dockerCapabilities(maxConcurrent);
      const active = new Set<string>();

      const releaseResources = (box: {
        readonly id: string;
        readonly containerName: string;
        readonly volumeName: string;
      }): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* docker
            .run({ args: dockerKillArgs(box.containerName) })
            .pipe(Effect.catch(() => Effect.void));
          yield* docker
            .run({ args: dockerRmArgs(box.containerName) })
            .pipe(Effect.catch(() => Effect.void));
          yield* docker
            .run({ args: dockerVolumeRmArgs(box.volumeName) })
            .pipe(Effect.catch(() => Effect.void));
          active.delete(box.id);
        });

      const allocate = (
        options?: CreateSandboxOptions
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
            });

            yield* dockerStep(createArgs, "docker create");
            yield* dockerStep(dockerStartArgs(containerName), "docker start");

            let teardown: Effect.Effect<void> | undefined;
            const children = new Set<ChildProcessHandle>();

            const destroy = (): Effect.Effect<void> =>
              Effect.suspend(() => {
                if (!teardown) {
                  teardown = Effect.uninterruptibleMask((restore) =>
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
                      );
                      children.clear();
                      yield* releaseResources({
                        id,
                        containerName,
                        volumeName,
                      });
                    })
                  );
                }
                return teardown;
              });

            return {
              id,
              containerName,
              volumeName,
              cwd: DOCKER_WORKSPACE_PATH,
              children,
              destroy,
            } satisfies DockerBox;
          }),
          (box) => box.destroy()
        );

      const create = (options?: CreateSandboxOptions) =>
        allocate(options).pipe(
          Effect.map((box) => {
            const exec = (
              command: string,
              args: readonly string[] = []
            ): Effect.Effect<ExecResult, SandboxExecError> =>
              Effect.gen(function* () {
                const result = yield* docker
                  .run({
                    args: dockerExecInteractiveArgs({
                      container: box.containerName,
                      command,
                      args,
                      workdir: DOCKER_WORKSPACE_PATH,
                      user: config.user,
                    }),
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
          })
        );

      const acquire = (
        options?: AcquireSandboxOptions
      ): Effect.Effect<SandboxLease, AcquireSandboxError, Scope.Scope> =>
        Effect.gen(function* () {
          yield* assertCapabilities(options?.requirements, effective);
          const box = yield* allocate(options);
          let released = false;
          let workerRan = false;

          const release = (): Effect.Effect<void> =>
            Effect.suspend(() => {
              if (released) {
                return Effect.void;
              }
              released = true;
              return box.destroy();
            });

          yield* Effect.addFinalizer(() => release());

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
