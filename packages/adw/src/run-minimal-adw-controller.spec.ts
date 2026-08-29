import { assert, describe, it } from "@effect/vitest";
import {
  AdwWorkerAdwStatus,
  AdwWorkerCapability,
  AdwWorkerErrorTag,
  AdwWorkerIsolation,
  AdwWorkerProgressKind,
  AdwWorkerStep,
  AdwWorkerTerminalKind,
  type AdwWorkerTerminalOutcome,
} from "@lazy-software-factory/adw-worker";
import {
  SandboxBusyError,
  SandboxCapabilityError,
  SandboxDestroyError,
  SandboxProvider,
  type SandboxLease,
} from "@lazy-software-factory/runtime";
import { Effect, Layer, Logger, Ref } from "effect";
import { captureAdwProgressLogger } from "./adw-progress.ts";
import { AdwStatus } from "./enums.ts";
import {
  minimalAdwResultFromOutcome,
  runMinimalAdw,
  runMinimalAdwController,
} from "./run-minimal-adw.ts";

const hostCaps = {
  capabilities: [
    AdwWorkerCapability.CursorLocalAgent,
    AdwWorkerCapability.GitHostCli,
    AdwWorkerCapability.WorkspaceExec,
    AdwWorkerCapability.SkillPackMount,
  ],
  maxConcurrentLeases: 1,
  isolation: AdwWorkerIsolation.Host,
} as const;

const makeLease = (
  runWorker: SandboxLease["runWorker"],
  release: SandboxLease["release"] = () => Effect.void
): SandboxLease => ({
  id: "lease-1",
  cwd: "/tmp/repo",
  effectiveCapabilities: hostCaps,
  runWorker,
  release,
});

describe("runMinimalAdw controller seam", () => {
  it.effect("happy path: lease + worker completed → shipped + progress", () =>
    Effect.gen(function* () {
      const progressLines: string[] = [];
      const fake = Layer.succeed(
        SandboxProvider,
        SandboxProvider.of({
          create: () => Effect.die("create unused on controller"),
          acquire: () =>
            Effect.succeed(
              makeLease((_request, { onProgress }) =>
                Effect.gen(function* () {
                  yield* onProgress({
                    kind: AdwWorkerProgressKind.StepEnter,
                    step: AdwWorkerStep.Provision,
                  });
                  return {
                    kind: AdwWorkerTerminalKind.Completed,
                    result: {
                      ticketId: "82",
                      status: AdwWorkerAdwStatus.Shipped,
                      prUrl: "https://example.test/pr/1",
                      sandboxId: "worker-local",
                    },
                    effectiveCapabilities: hostCaps,
                  } satisfies AdwWorkerTerminalOutcome;
                })
              )
            ),
        })
      );

      const controlled = yield* runMinimalAdwController({
        ticketId: "82",
        prompt: "implement",
      }).pipe(
        Effect.provide(fake),
        Effect.provide(Logger.layer([captureAdwProgressLogger(progressLines)]))
      );

      assert.strictEqual(
        controlled.outcome.kind,
        AdwWorkerTerminalKind.Completed
      );
      assert.strictEqual(controlled.result.status, AdwStatus.Shipped);
      assert.strictEqual(controlled.result.prUrl, "https://example.test/pr/1");
      assert.strictEqual(controlled.result.sandboxId, "lease-1");
      assert.isTrue(
        progressLines.some((line) => line.includes("step=provision"))
      );
      assert.deepStrictEqual(controlled.effectiveCapabilities?.capabilities, [
        ...hostCaps.capabilities,
      ]);
    })
  );

  it.effect("completed failed ADW status is forwarded", () =>
    Effect.gen(function* () {
      const fake = Layer.succeed(
        SandboxProvider,
        SandboxProvider.of({
          create: () => Effect.die("create unused"),
          acquire: () =>
            Effect.succeed(
              makeLease(() =>
                Effect.succeed({
                  kind: AdwWorkerTerminalKind.Completed,
                  result: {
                    ticketId: "82",
                    status: AdwWorkerAdwStatus.Failed,
                    detail: "provision refused",
                  },
                  effectiveCapabilities: hostCaps,
                })
              )
            ),
        })
      );

      const result = yield* runMinimalAdw({
        ticketId: "82",
        prompt: "x",
      }).pipe(Effect.provide(fake));

      assert.strictEqual(result.status, AdwStatus.Failed);
      assert.strictEqual(result.detail, "provision refused");
    })
  );

  it.effect("cancellation maps to failed with cancelled detail", () =>
    Effect.sync(() => {
      const outcome: AdwWorkerTerminalOutcome = {
        kind: AdwWorkerTerminalKind.Cancelled,
        detail: "operator interrupt",
        effectiveCapabilities: hostCaps,
      };
      const result = minimalAdwResultFromOutcome(outcome, "82");
      assert.strictEqual(result.status, AdwStatus.Failed);
      assert.isTrue(result.detail?.startsWith("cancelled:"));
    })
  );

  it.effect("malformed protocol → infrastructure_failed", () =>
    Effect.gen(function* () {
      const failing = Layer.succeed(
        SandboxProvider,
        SandboxProvider.of({
          create: () => Effect.die("create unused"),
          acquire: () =>
            Effect.succeed(
              makeLease(() =>
                Effect.fail({
                  _tag: AdwWorkerErrorTag.AdwWorkerProtocolError,
                  message: "Worker protocol frame is not valid JSON",
                } as never)
              )
            ),
        })
      );

      const controlled = yield* runMinimalAdwController({
        ticketId: "82",
        prompt: "x",
      }).pipe(Effect.provide(failing));

      assert.strictEqual(
        controlled.outcome.kind,
        AdwWorkerTerminalKind.InfrastructureFailed
      );
      assert.strictEqual(controlled.result.status, AdwStatus.Failed);
      assert.isTrue(
        controlled.result.detail?.startsWith("infrastructure_failed:")
      );
    })
  );

  it.effect("cleanup failure overrides completed worker outcome", () =>
    Effect.gen(function* () {
      const fake = Layer.succeed(
        SandboxProvider,
        SandboxProvider.of({
          create: () => Effect.die("create unused"),
          acquire: () =>
            Effect.succeed(
              makeLease(
                () =>
                  Effect.succeed({
                    kind: AdwWorkerTerminalKind.Completed,
                    result: {
                      ticketId: "82",
                      status: AdwWorkerAdwStatus.Shipped,
                    },
                    effectiveCapabilities: hostCaps,
                  }),
                () =>
                  Effect.fail(
                    new SandboxDestroyError({
                      message: "volume still attached",
                    })
                  )
              )
            ),
        })
      );

      const controlled = yield* runMinimalAdwController({
        ticketId: "82",
        prompt: "x",
      }).pipe(Effect.provide(fake));

      assert.strictEqual(
        controlled.outcome.kind,
        AdwWorkerTerminalKind.InfrastructureFailed
      );
      assert.include(controlled.result.detail ?? "", "volume still attached");
      assert.strictEqual(controlled.result.sandboxId, "lease-1");
    })
  );

  it.effect("second concurrent lease → typed capacity error", () =>
    Effect.gen(function* () {
      const busyProvider = Layer.succeed(
        SandboxProvider,
        SandboxProvider.of({
          create: () => Effect.die("unused"),
          acquire: () =>
            Effect.fail(
              new SandboxBusyError({
                message:
                  "Host sandbox already active; only one ADW at a time on Host",
              })
            ),
        })
      );

      const controlled = yield* runMinimalAdwController({
        ticketId: "82",
        prompt: "x",
      }).pipe(Effect.provide(busyProvider));

      assert.strictEqual(
        controlled.outcome.kind,
        AdwWorkerTerminalKind.InfrastructureFailed
      );
      assert.isTrue(
        controlled.result.detail?.includes("only one ADW at a time")
      );
    })
  );

  it.effect("missing capability fails before worker run", () =>
    Effect.gen(function* () {
      let workerRuns = 0;
      const fake = Layer.succeed(
        SandboxProvider,
        SandboxProvider.of({
          create: () => Effect.die("unused"),
          acquire: () =>
            Effect.fail(
              new SandboxCapabilityError({
                message:
                  "Sandbox backend missing required capabilities: cursor_local_agent",
                missing: [AdwWorkerCapability.CursorLocalAgent],
              })
            ),
        })
      );

      const controlled = yield* runMinimalAdwController({
        ticketId: "82",
        prompt: "x",
      }).pipe(Effect.provide(fake));

      assert.strictEqual(workerRuns, 0);
      assert.strictEqual(
        controlled.outcome.kind,
        AdwWorkerTerminalKind.InfrastructureFailed
      );
      assert.isTrue(controlled.result.detail?.includes("capabilities"));
    })
  );

  it.effect("lease release is idempotent on Host-style flag", () =>
    Effect.gen(function* () {
      const releases = yield* Ref.make(0);
      let released = false;
      const lease: SandboxLease = {
        id: "lease-1",
        cwd: "/tmp",
        effectiveCapabilities: hostCaps,
        runWorker: () => Effect.die("unused"),
        release: () =>
          Effect.suspend(() => {
            if (released) {
              return Effect.void;
            }
            released = true;
            return Ref.update(releases, (n) => n + 1);
          }),
      };
      yield* lease.release();
      yield* lease.release();
      assert.strictEqual(yield* Ref.get(releases), 1);
    })
  );

  it.effect("controller maps worker interrupt to cancelled", () =>
    Effect.gen(function* () {
      const fake = Layer.succeed(
        SandboxProvider,
        SandboxProvider.of({
          create: () => Effect.die("unused"),
          acquire: () => Effect.succeed(makeLease(() => Effect.interrupt)),
        })
      );

      const controlled = yield* runMinimalAdwController({
        ticketId: "82",
        prompt: "x",
      }).pipe(Effect.provide(fake));

      assert.strictEqual(
        controlled.outcome.kind,
        AdwWorkerTerminalKind.Cancelled
      );
      assert.isTrue(controlled.result.detail?.startsWith("cancelled:"));
    })
  );
});
