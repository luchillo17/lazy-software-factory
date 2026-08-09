import { NodeCrypto } from "@effect/platform-node";
import { Context, Effect, Layer, Scope } from "effect";
import { Crypto } from "effect/Crypto";
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner";
import {
  SandboxBusyError,
  SandboxCreateError,
  SandboxExecError,
} from "./errors.ts";
import { runCapturedProcess } from "./run-captured-process.ts";
import type { CreateSandboxOptions, ExecResult, Sandbox } from "./sandbox.ts";

export type { CreateSandboxOptions, ExecResult, Sandbox } from "./sandbox.ts";

export class SandboxProvider extends Context.Service<
  SandboxProvider,
  {
    /**
     * Create a warm sandbox. Requires `Scope` so `destroy` (and child kill)
     * always run when the scope closes — Host slot cannot leak on abort.
     */
    readonly create: (
      options?: CreateSandboxOptions
    ) => Effect.Effect<
      Sandbox,
      SandboxCreateError | SandboxBusyError,
      Scope.Scope
    >;
  }
>()("@lazy-software-factory/runtime/SandboxProvider") {
  /**
   * Host warm sandbox: create/exec/destroy on this machine.
   * One active Host sandbox at a time (single-ADW-at-a-time).
   */
  static readonly Host = Layer.effect(
    SandboxProvider,
    Effect.gen(function* () {
      const crypto = yield* Crypto;

      let activeId: string | undefined;

      const create = Effect.fn("SandboxProvider.create")(function* (
        options?: CreateSandboxOptions
      ) {
        const sandbox = yield* Effect.acquireRelease(
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
              exec: (
                command: string,
                args: readonly string[] = []
              ): Effect.Effect<ExecResult, SandboxExecError> =>
                Effect.gen(function* () {
                  if (destroyed || activeId !== id) {
                    return yield* new SandboxExecError({
                      message: `Sandbox ${id} is destroyed`,
                    });
                  }

                  return yield* runCapturedProcess({
                    command,
                    args,
                    cwd,
                    env,
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
            } satisfies Sandbox;
          }),
          (box) => box.destroy()
        );

        return sandbox;
      });

      return SandboxProvider.of({ create });
    })
  ).pipe(Layer.provide(NodeCrypto.layer));
}
