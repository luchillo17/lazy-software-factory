import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Context, Effect, Layer, Scope } from "effect";
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
    Effect.sync(() => {
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

            const id = randomUUID();
            activeId = id;
            const cwd = options?.cwd ?? process.cwd();
            const env = options?.env
              ? { ...process.env, ...options.env }
              : process.env;

            let destroyed = false;
            let teardown: Effect.Effect<void> | undefined;
            const children = new Set<ChildProcess>();

            const releaseSlot = () => {
              if (activeId === id) {
                activeId = undefined;
              }
            };

            const waitForChildExit = (child: ChildProcess) =>
              Effect.callback<void>((resume) => {
                let settled = false;
                const finish = () => {
                  if (settled) {
                    return;
                  }
                  settled = true;
                  resume(Effect.void);
                };
                if (child.exitCode !== null || child.signalCode !== null) {
                  finish();
                  return;
                }
                // Prefer `exit` (does not wait for stdio drain); also accept `close`.
                child.once("exit", finish);
                child.once("close", finish);
              });

            const waitForChildExitBounded = (child: ChildProcess) =>
              waitForChildExit(child).pipe(
                Effect.timeout("5 seconds"),
                Effect.catchTag("TimeoutError", () =>
                  Effect.gen(function* () {
                    if (child.exitCode === null && child.signalCode === null) {
                      child.kill("SIGKILL");
                    }
                    yield* waitForChildExit(child).pipe(
                      Effect.timeout("2 seconds"),
                      Effect.catchTag("TimeoutError", () => Effect.void)
                    );
                  })
                )
              );

            const destroy = (): Effect.Effect<void> =>
              Effect.suspend(() => {
                if (!teardown) {
                  teardown = Effect.uninterruptibleMask((restore) =>
                    Effect.gen(function* () {
                      destroyed = true;
                      const pending = [...children];
                      for (const child of pending) {
                        if (!child.killed) {
                          child.kill("SIGTERM");
                        }
                      }
                      // restore so timeout can interrupt the wait; ensuring still frees slot
                      yield* restore(
                        Effect.forEach(pending, waitForChildExitBounded, {
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

                  return yield* Effect.tryPromise({
                    try: (signal) =>
                      runCapturedProcess({
                        command,
                        args,
                        cwd,
                        env,
                        signal,
                        onSpawn: (child) => {
                          children.add(child);
                        },
                        onSettle: (child) => {
                          children.delete(child);
                        },
                      }),
                    catch: (cause) =>
                      new SandboxExecError({
                        message: `Failed to exec in sandbox ${id}`,
                        cause,
                      }),
                  });
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
  );
}
