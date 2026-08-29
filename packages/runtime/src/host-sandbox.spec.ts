import { mkdtemp, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Cause } from "effect";
import { SandboxProvider } from "./sandbox-provider.ts";

describe("Host SandboxProvider", () => {
  it.effect("create → exec trivial command → destroy succeeds", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const provider = yield* SandboxProvider;
        const sandbox = yield* provider.create({ cwd: process.cwd() });

        assert.isString(sandbox.id);
        assert.isTrue(sandbox.id.length > 0);

        const result = yield* sandbox.exec({
          command: "node",
          argv: [
            "-e",
            'process.stdin.on("data", (chunk) => process.stdout.write(`${process.env["EXEC_MARKER"]}:${process.cwd()}:${chunk}`))',
          ],
          cwd: process.cwd(),
          env: { EXEC_MARKER: "ok" },
          stdin: "input",
        });

        assert.strictEqual(result.exitCode, 0);
        assert.strictEqual(result.stdout, `ok:${process.cwd()}:input`);

        yield* sandbox.destroy();
      })
    ).pipe(Effect.provide(SandboxProvider.Host))
  );

  it.effect("scope exit releases Host slot without explicit destroy", () =>
    Effect.gen(function* () {
      const provider = yield* SandboxProvider;

      yield* Effect.scoped(provider.create({ cwd: process.cwd() }));

      yield* Effect.scoped(
        Effect.gen(function* () {
          const again = yield* provider.create({ cwd: process.cwd() });
          assert.isString(again.id);
        })
      );
    }).pipe(Effect.provide(SandboxProvider.Host))
  );

  it.live("destroy waits for in-flight exec before new create", () =>
    Effect.gen(function* () {
      const provider = yield* SandboxProvider;

      yield* Effect.scoped(
        Effect.gen(function* () {
          const sandbox = yield* provider.create({ cwd: process.cwd() });
          const fiber = yield* Effect.forkChild(
            sandbox.exec({
              command: "node",
              argv: ["-e", "setTimeout(() => {}, 10_000)"],
            })
          );
          yield* Effect.sleep("30 millis");
          yield* sandbox.destroy();
          yield* Effect.ignore(Fiber.join(fiber));
        })
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const again = yield* provider.create({ cwd: process.cwd() });
          assert.isString(again.id);
        })
      );
    }).pipe(Effect.provide(SandboxProvider.Host))
  );

  it.live("exec timeout aborts and kills the child process", () =>
    Effect.gen(function* () {
      const provider = yield* SandboxProvider;
      const dir = yield* Effect.tryPromise(() =>
        mkdtemp(join(tmpdir(), "host-sandbox-"))
      );
      const pidFile = join(dir, "pid");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const sandbox = yield* provider.create({ cwd: process.cwd() });

          const exit = yield* sandbox
            .exec({
              command: "node",
              argv: [
                "-e",
                `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 60_000)`,
              ],
              timeoutMs: 1_500,
            })
            .pipe(Effect.exit);

          assert.isTrue(exit._tag === "Failure");

          const pid = Number(
            (yield* Effect.tryPromise(() => readFile(pidFile, "utf8"))).trim()
          );
          assert.isTrue(Number.isFinite(pid) && pid > 0);

          yield* Effect.sleep("50 millis");

          const alive = yield* Effect.sync(() => {
            try {
              process.kill(pid, 0);
              return true;
            } catch {
              return false;
            }
          });
          assert.isFalse(alive);

          yield* Effect.tryPromise(() => unlink(pidFile)).pipe(
            Effect.catch(() => Effect.void)
          );
        })
      );
    }).pipe(Effect.provide(SandboxProvider.Host))
  );
});

describe("Host SandboxProvider.acquire", () => {
  it.effect("second concurrent acquire returns SandboxBusyError", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const provider = yield* SandboxProvider;
        yield* provider.acquire({ cwd: process.cwd() });
        const second = yield* provider
          .acquire({ cwd: process.cwd() })
          .pipe(Effect.exit);
        assert.strictEqual(second._tag, "Failure");
        if (second._tag === "Failure") {
          const squashed = Cause.squash(second.cause);
          assert.strictEqual(
            (squashed as { _tag?: string })._tag,
            "SandboxBusyError"
          );
        }
      })
    ).pipe(Effect.provide(SandboxProvider.Host))
  );
});
