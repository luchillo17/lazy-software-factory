import { assert, describe, it } from "@effect/vitest";
import {
  AdwWorkerIsolation,
  AdwWorkerSupportLevel,
  AdwWorkerTerminalKind,
} from "@lazy-software-factory/adw-worker";
import { NodeCrypto } from "@effect/platform-node";
import { Effect, Layer, Ref } from "effect";
import { DOCKER_WORKSPACE_PATH } from "./docker-argv.ts";
import { DockerCli } from "./docker-cli.ts";
import {
  makeDockerSandboxProviderLayer,
  rejectDockerHostSourceIntake,
} from "./docker-sandbox.ts";
import { SandboxCreateError, SandboxProvider } from "./index.ts";

const recordingDockerCli = (seen: Ref.Ref<readonly string[][]>) =>
  Layer.succeed(
    DockerCli,
    DockerCli.of({
      run: ({ args }) =>
        Effect.gen(function* () {
          yield* Ref.update(seen, (s) => [...s, [...args]]);
          const head = args[0];
          if (head === "volume" && args[1] === "create") {
            return {
              exitCode: 0,
              stdout: `${args[args.length - 1]}\n`,
              stderr: "",
            };
          }
          if (head === "create" || head === "start") {
            return { exitCode: 0, stdout: "cid\n", stderr: "" };
          }
          if (
            head === "kill" ||
            head === "rm" ||
            (head === "volume" && args[1] === "rm")
          ) {
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        }),
    })
  );

describe("rejectDockerHostSourceIntake", () => {
  it.effect("rejects host cwd bind-mount intake", () =>
    Effect.gen(function* () {
      const result = yield* rejectDockerHostSourceIntake({
        cwd: "/home/me/repo",
      }).pipe(Effect.exit);
      assert.strictEqual(result._tag, "Failure");
    })
  );

  it.effect("rejects image on acquire options", () =>
    Effect.gen(function* () {
      const result = yield* rejectDockerHostSourceIntake({
        image: "custom:latest",
      }).pipe(Effect.exit);
      assert.strictEqual(result._tag, "Failure");
    })
  );

  it.effect("allows omitted cwd (remote Git intake)", () =>
    Effect.gen(function* () {
      yield* rejectDockerHostSourceIntake({});
    })
  );
});

describe("Docker SandboxProvider (faked CLI)", () => {
  it.effect(
    "acquire creates volume + hardened container and reports unsupported quotas",
    () =>
      Effect.gen(function* () {
        const seen = yield* Ref.make<readonly string[][]>([]);
        const layer = makeDockerSandboxProviderLayer({
          image: "factory-adw-worker:test",
        }).pipe(
          Layer.provide(NodeCrypto.layer),
          Layer.provide(recordingDockerCli(seen))
        );

        yield* Effect.scoped(
          Effect.gen(function* () {
            const provider = yield* SandboxProvider;
            const lease = yield* provider.acquire({});
            assert.strictEqual(lease.cwd, DOCKER_WORKSPACE_PATH);
            assert.strictEqual(
              lease.effectiveCapabilities.isolation,
              AdwWorkerIsolation.Container
            );
            assert.strictEqual(
              lease.effectiveCapabilities.retainedWorkspaces,
              AdwWorkerSupportLevel.Unsupported
            );
            assert.strictEqual(
              lease.effectiveCapabilities.diskQuota,
              AdwWorkerSupportLevel.Unsupported
            );
          })
        ).pipe(Effect.provide(layer));

        const calls = yield* Ref.get(seen);
        assert.isTrue(
          calls.some((a) => a[0] === "volume" && a[1] === "create")
        );
        assert.isTrue(
          calls.some((a) => a[0] === "create" && a.includes("--read-only"))
        );
        assert.isTrue(calls.some((a) => a[0] === "start"));
        assert.isTrue(
          calls.some((a) => a[0] === "rm" && a.includes("--force"))
        );
        assert.isTrue(
          calls.some(
            (a) => a[0] === "volume" && a[1] === "rm" && a.includes("--force")
          )
        );
        assert.isFalse(
          calls.some((a) =>
            a.some((part) => /CURSOR_API_KEY|GH_TOKEN/.test(part))
          ),
          "secrets must not appear in Docker CLI argv"
        );
      })
  );

  it.effect("acquire with host cwd fails before Docker allocation", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<readonly string[][]>([]);
      const layer = makeDockerSandboxProviderLayer({
        image: "factory-adw-worker:test",
      }).pipe(
        Layer.provide(NodeCrypto.layer),
        Layer.provide(recordingDockerCli(seen))
      );

      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const provider = yield* SandboxProvider;
          return yield* provider.acquire({ cwd: "/tmp/host-repo" });
        })
      ).pipe(Effect.provide(layer), Effect.exit);

      assert.strictEqual(result._tag, "Failure");
      const calls = yield* Ref.get(seen);
      assert.strictEqual(calls.length, 0);
    })
  );

  it.effect("release is idempotent and always removes container + volume", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<readonly string[][]>([]);
      const layer = makeDockerSandboxProviderLayer({
        image: "factory-adw-worker:test",
      }).pipe(
        Layer.provide(NodeCrypto.layer),
        Layer.provide(recordingDockerCli(seen))
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const provider = yield* SandboxProvider;
          const lease = yield* provider.acquire({});
          yield* lease.release();
          yield* lease.release();
        })
      ).pipe(Effect.provide(layer));

      const calls = yield* Ref.get(seen);
      const rms = calls.filter((a) => a[0] === "rm");
      const volRms = calls.filter((a) => a[0] === "volume" && a[1] === "rm");
      assert.isTrue(rms.length >= 1);
      assert.isTrue(volRms.length >= 1);
    })
  );
});

void SandboxCreateError;
void AdwWorkerTerminalKind;
