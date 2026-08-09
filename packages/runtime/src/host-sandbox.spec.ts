import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { SandboxProvider } from "./sandbox-provider.ts";

describe("Host SandboxProvider", () => {
  it.effect("create → exec trivial command → destroy succeeds", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const provider = yield* SandboxProvider;
        const sandbox = yield* provider.create({ cwd: process.cwd() });

        assert.isString(sandbox.id);
        assert.isTrue(sandbox.id.length > 0);

        const result = yield* sandbox.exec("node", [
          "-e",
          'process.stdout.write("ok")',
        ]);

        assert.strictEqual(result.exitCode, 0);
        assert.strictEqual(result.stdout, "ok");

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
            sandbox.exec("node", ["-e", "setTimeout(() => {}, 10_000)"])
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
});
