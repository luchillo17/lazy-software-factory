import { assert, describe, it } from "@effect/vitest";
import {
  AdwWorkerCapability,
  AdwWorkerIsolation,
  AdwWorkerSandboxFeature,
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
import {
  SandboxBusyError,
  SandboxCreateError,
  SandboxProvider,
} from "./index.ts";

const recordingDockerCli = (
  seen: Ref.Ref<readonly string[][]>,
  options: { readonly failCleanup?: boolean } = {}
) =>
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
            if (
              options.failCleanup &&
              (head === "rm" || (head === "volume" && args[1] === "rm"))
            ) {
              return {
                exitCode: 1,
                stdout: "",
                stderr: `forced ${head} cleanup failure`,
              };
            }
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
        assert.isTrue(
          calls.some(
            (a) =>
              a[0] === "create" &&
              a.includes("npm_config_store_dir=/home/adw/.cache/pnpm-store")
          )
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

  it.effect("hard disk_quota fails before any Docker CLI allocation", () =>
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
          return yield* provider.acquire({
            requirements: {
              hard: [AdwWorkerCapability.WorkspaceExec],
              hardFeatures: [AdwWorkerSandboxFeature.DiskQuota],
            },
          });
        })
      ).pipe(Effect.provide(layer), Effect.exit);

      assert.strictEqual(result._tag, "Failure");
      const calls = yield* Ref.get(seen);
      assert.strictEqual(calls.length, 0);
    })
  );

  it.effect(
    "soft unsupported features remain visible; resource limits hit docker create",
    () =>
      Effect.gen(function* () {
        const seen = yield* Ref.make<readonly string[][]>([]);
        const layer = makeDockerSandboxProviderLayer({
          image: "factory-adw-worker:test",
          defaultLimits: { cpu: 0.5 },
        }).pipe(
          Layer.provide(NodeCrypto.layer),
          Layer.provide(recordingDockerCli(seen))
        );

        yield* Effect.scoped(
          Effect.gen(function* () {
            const provider = yield* SandboxProvider;
            const lease = yield* provider.acquire({
              requirements: {
                hard: [AdwWorkerCapability.WorkspaceExec],
                softFeatures: [AdwWorkerSandboxFeature.RetainedWorkspaces],
                hardLimits: {
                  cpu: 1,
                  memoryBytes: 134_217_728,
                  pidsLimit: 64,
                  lifetimeMs: 120_000,
                },
              },
            });
            assert.deepStrictEqual(
              lease.effectiveCapabilities.unmetSoftFeatures,
              [AdwWorkerSandboxFeature.RetainedWorkspaces]
            );
            assert.strictEqual(lease.effectiveCapabilities.limits?.cpu, 1);
            assert.strictEqual(
              lease.effectiveCapabilities.limits?.memoryBytes,
              134_217_728
            );
            assert.strictEqual(
              lease.effectiveCapabilities.limits?.pidsLimit,
              64
            );
            assert.strictEqual(
              lease.effectiveCapabilities.limits?.lifetimeMs,
              120_000
            );
          })
        ).pipe(Effect.provide(layer));

        const calls = yield* Ref.get(seen);
        const create = calls.find((a) => a[0] === "create");
        assert.isTrue(create !== undefined);
        assert.isTrue(create!.includes("--cpus"));
        assert.isTrue(create!.includes("1"));
        assert.isTrue(create!.includes("--memory"));
        assert.isTrue(create!.includes("134217728"));
        assert.isTrue(create!.includes("--pids-limit"));
        assert.isTrue(create!.includes("64"));
      })
  );

  it.effect(
    "capacity exhaustion returns Busy immediately without allocating",
    () =>
      Effect.gen(function* () {
        const seen = yield* Ref.make<readonly string[][]>([]);
        const layer = makeDockerSandboxProviderLayer({
          image: "factory-adw-worker:test",
          maxConcurrentLeases: 1,
        }).pipe(
          Layer.provide(NodeCrypto.layer),
          Layer.provide(recordingDockerCli(seen))
        );

        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const provider = yield* SandboxProvider;
            const first = yield* provider.acquire({});
            assert.isString(first.id);
            return yield* provider.acquire({}).pipe(Effect.exit);
          })
        ).pipe(Effect.provide(layer));

        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.isTrue(
            String(result.cause).includes(SandboxBusyError.name) ||
              String(result.cause).includes("SandboxBusyError")
          );
        }
      })
  );

  it.effect(
    "cleanup reports failures after attempting container and volume",
    () =>
      Effect.gen(function* () {
        const seen = yield* Ref.make<readonly string[][]>([]);
        const layer = makeDockerSandboxProviderLayer({
          image: "factory-adw-worker:test",
        }).pipe(
          Layer.provide(NodeCrypto.layer),
          Layer.provide(recordingDockerCli(seen, { failCleanup: true }))
        );

        const exit = yield* Effect.scoped(
          Effect.gen(function* () {
            const provider = yield* SandboxProvider;
            const lease = yield* provider.acquire({});
            yield* lease.release();
          })
        ).pipe(Effect.provide(layer), Effect.exit);

        assert.strictEqual(exit._tag, "Failure");
        if (exit._tag === "Failure") {
          assert.include(String(exit.cause), "forced rm cleanup failure");
          assert.include(String(exit.cause), "forced volume cleanup failure");
        }
        const calls = yield* Ref.get(seen);
        assert.isTrue(calls.some((args) => args[0] === "rm"));
        assert.isTrue(
          calls.some((args) => args[0] === "volume" && args[1] === "rm")
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
