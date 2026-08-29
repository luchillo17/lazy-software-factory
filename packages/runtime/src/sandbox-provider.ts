import {
  AdwWorkerCapability,
  AdwWorkerIsolation,
  AdwWorkerSupportLevel,
  type AdwWorkerEffectiveCapabilities,
  type AdwWorkerProgressEvent,
  type AdwWorkerRequest,
} from "@lazy-software-factory/adw-worker";
import { NodeCrypto } from "@effect/platform-node";
import { Context, Effect, Layer, Scope } from "effect";
import { Crypto } from "effect/Crypto";
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner";
import {
  SandboxBusyError,
  SandboxCreateError,
  SandboxExecError,
  SandboxWorkerError,
} from "./errors.ts";
import {
  runHostWorkerProcess,
  type HostWorkerLaunch,
} from "./host-worker-runner.ts";
import { runCapturedProcess } from "./run-captured-process.ts";
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

export type {
  CreateSandboxOptions,
  ExecResult,
  Sandbox,
  SandboxExecOptions,
} from "./sandbox.ts";
export type {
  AcquireSandboxError,
  AcquireSandboxOptions,
  SandboxLease,
} from "./sandbox-lease.ts";

const hostProfile = (): BackendCapabilityProfile => ({
  capabilities: [
    AdwWorkerCapability.CursorLocalAgent,
    AdwWorkerCapability.GitHostCli,
    AdwWorkerCapability.WorkspaceExec,
    AdwWorkerCapability.SkillPackMount,
  ],
  maxConcurrentLeases: 1,
  isolation: AdwWorkerIsolation.Host,
  diskQuota: AdwWorkerSupportLevel.Unsupported,
  retainedWorkspaces: AdwWorkerSupportLevel.Unsupported,
  // Host does not enforce cgroup CPU/memory/PID or lease lifetime.
  enforceableLimits: new Set(),
});

export interface HostSandboxOptions {
  /** How the Host lease launches the versioned ADW worker process. */
  readonly workerLaunch: HostWorkerLaunch;
  readonly terminateGrace?: `${number} seconds` | `${number} millis`;
}

type HostBox = {
  readonly id: string;
  readonly cwd: string;
  readonly children: Set<ChildProcessHandle>;
  readonly exec: (
    options: SandboxExecOptions
  ) => Effect.Effect<ExecResult, SandboxExecError>;
  readonly destroy: () => Effect.Effect<void>;
};

const makeLocalSandbox = (options?: CreateSandboxOptions): Sandbox => {
  const id = "local";
  const cwd = options?.cwd ?? process.cwd();
  const env = options?.env ? { ...process.env, ...options.env } : process.env;
  let destroyed = false;
  return {
    id,
    cwd,
    exec: (execOptions) =>
      Effect.gen(function* () {
        if (destroyed) {
          return yield* new SandboxExecError({
            message: `Sandbox ${id} is destroyed`,
          });
        }
        return yield* runCapturedProcess({
          command: execOptions.command,
          args: execOptions.argv ?? [],
          cwd: execOptions.cwd ?? cwd,
          env: execOptions.env ? { ...env, ...execOptions.env } : env,
          stdin: execOptions.stdin,
          timeoutMs: execOptions.timeoutMs,
          extendEnv: false,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new SandboxExecError({
                message: `Failed to exec in sandbox ${id}`,
                cause,
              })
          )
        );
      }),
    destroy: () =>
      Effect.sync(() => {
        destroyed = true;
      }),
  };
};

export class SandboxProvider extends Context.Service<
  SandboxProvider,
  {
    /**
     * Create a warm sandbox for in-process exec (worker-internal / tests).
     * Host `create` also takes the single-ADW capacity slot.
     */
    readonly create: (
      options?: CreateSandboxOptions
    ) => Effect.Effect<
      Sandbox,
      SandboxCreateError | SandboxBusyError,
      Scope.Scope
    >;
    /**
     * Acquire a scoped Sandbox lease, validate capabilities, and run one ADW
     * worker through the provider (controller seam).
     */
    readonly acquire: (
      options?: AcquireSandboxOptions
    ) => Effect.Effect<SandboxLease, AcquireSandboxError, Scope.Scope>;
  }
>()("@lazy-software-factory/runtime/SandboxProvider") {
  /**
   * Worker-local sandbox: cwd/env exec with no Host capacity slot.
   * Used inside the ADW worker process.
   */
  static readonly Local = Layer.succeed(
    SandboxProvider,
    SandboxProvider.of({
      create: (options) =>
        Effect.acquireRelease(
          Effect.succeed(makeLocalSandbox(options)),
          (box) => box.destroy().pipe(Effect.orDie)
        ),
      acquire: () =>
        Effect.fail(
          new SandboxCreateError({
            message:
              "SandboxProvider.Local cannot acquire a controller lease; use Host (or Docker) from the controller",
          })
        ),
    })
  );

  /** Host warm sandbox + single lease capacity + ADW worker spawn. */
  static readonly host = (config: HostSandboxOptions) =>
    Layer.effect(
      SandboxProvider,
      Effect.gen(function* () {
        const crypto = yield* Crypto;
        const profile = hostProfile();

        let activeId: string | undefined;

        const allocateHostBox = (
          options?: CreateSandboxOptions
        ): Effect.Effect<
          HostBox,
          SandboxCreateError | SandboxBusyError,
          Scope.Scope
        > =>
          Effect.acquireRelease(
            Effect.gen(function* () {
              if (activeId !== undefined) {
                return yield* new SandboxBusyError({
                  message:
                    "Host sandbox already active; only one ADW at a time on Host",
                });
              }

              const id = yield* crypto.randomUUIDv4.pipe(
                Effect.mapError(
                  (cause) =>
                    new SandboxCreateError({
                      message: "Failed to allocate sandbox id",
                      cause,
                    })
                )
              );
              activeId = id;
              const cwd = options?.cwd ?? process.cwd();
              const env = options?.env
                ? { ...process.env, ...options.env }
                : process.env;

              let destroyed = false;
              let teardown: Effect.Effect<void> | undefined;
              const children = new Set<ChildProcessHandle>();

              const releaseSlot = () => {
                if (activeId === id) {
                  activeId = undefined;
                }
              };

              const waitForHandleExitBounded = (handle: ChildProcessHandle) =>
                handle.exitCode.pipe(
                  Effect.asVoid,
                  Effect.timeout("5 seconds"),
                  Effect.catchTag("TimeoutError", () =>
                    Effect.gen(function* () {
                      yield* handle.kill({ killSignal: "SIGKILL" });
                      yield* handle.exitCode.pipe(
                        Effect.asVoid,
                        Effect.timeout("2 seconds"),
                        Effect.catchTag("TimeoutError", () => Effect.void)
                      );
                    })
                  ),
                  Effect.catch(() => Effect.void)
                );

              const destroy = (): Effect.Effect<void> =>
                Effect.suspend(() => {
                  if (!teardown) {
                    teardown = Effect.uninterruptibleMask((restore) =>
                      Effect.gen(function* () {
                        destroyed = true;
                        const pending = [...children];
                        for (const handle of pending) {
                          yield* handle
                            .kill({ killSignal: "SIGTERM" })
                            .pipe(Effect.catch(() => Effect.void));
                        }
                        yield* restore(
                          Effect.forEach(pending, waitForHandleExitBounded, {
                            concurrency: "unbounded",
                          })
                        );
                        children.clear();
                      }).pipe(Effect.ensuring(Effect.sync(releaseSlot)))
                    );
                  }
                  return teardown;
                });

              return {
                id,
                cwd,
                children,
                exec: (
                  execOptions: SandboxExecOptions
                ): Effect.Effect<ExecResult, SandboxExecError> =>
                  Effect.gen(function* () {
                    if (destroyed || activeId !== id) {
                      return yield* new SandboxExecError({
                        message: `Sandbox ${id} is destroyed`,
                      });
                    }

                    return yield* runCapturedProcess({
                      command: execOptions.command,
                      args: execOptions.argv ?? [],
                      cwd: execOptions.cwd ?? cwd,
                      env: execOptions.env
                        ? { ...env, ...execOptions.env }
                        : env,
                      stdin: execOptions.stdin,
                      timeoutMs: execOptions.timeoutMs,
                      extendEnv: false,
                      onSpawn: (handle) => {
                        children.add(handle);
                      },
                      onSettle: (handle) => {
                        children.delete(handle);
                      },
                    }).pipe(
                      Effect.mapError(
                        (cause) =>
                          new SandboxExecError({
                            message: `Failed to exec in sandbox ${id}`,
                            cause,
                          })
                      )
                    );
                  }),
                destroy,
              } satisfies HostBox;
            }),
            (box) => box.destroy()
          );

        const create = (options?: CreateSandboxOptions) =>
          allocateHostBox(options).pipe(
            Effect.map(
              (box) =>
                ({
                  id: box.id,
                  cwd: box.cwd,
                  exec: box.exec,
                  destroy: box.destroy,
                }) satisfies Sandbox
            )
          );

        const acquire = (
          options?: AcquireSandboxOptions
        ): Effect.Effect<SandboxLease, AcquireSandboxError, Scope.Scope> =>
          Effect.gen(function* () {
            const effective: AdwWorkerEffectiveCapabilities =
              yield* resolveEffectiveCapabilities(
                profile,
                options?.requirements
              );

            const box = yield* allocateHostBox(options);
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
                  if (released || activeId !== box.id) {
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
                  return yield* runHostWorkerProcess({
                    launch: config.workerLaunch,
                    request,
                    cwd: box.cwd,
                    env: options?.env
                      ? { ...process.env, ...options.env }
                      : process.env,
                    onProgress: workerOptions.onProgress,
                    terminateGrace: config.terminateGrace,
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
    ).pipe(Layer.provide(NodeCrypto.layer));

  /**
   * Default Host layer. Set `ADW_WORKER_MAIN` to the worker entry path
   * (tsx-loaded). Prefer {@link SandboxProvider.host} from Host operator wiring.
   */
  static readonly Host = SandboxProvider.host({
    workerLaunch: {
      command: process.execPath,
      args: [
        "--import",
        "tsx",
        process.env["ADW_WORKER_MAIN"] ??
          new URL("../../adw/src/adw-worker-main.ts", import.meta.url).pathname,
      ],
    },
  });
}
