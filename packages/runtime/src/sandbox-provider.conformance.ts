/**
 * Reusable SandboxProvider conformance suite.
 *
 * Covers portable lifecycle: requirements validation, allocation, optional
 * worker run / progress decode / terminal outcome / cancellation, idempotent
 * release, and effective metadata. Host and Docker share this module; callers
 * declare documented capability differences via {@link ConformanceExpectations}.
 */
import { assert, describe, it } from "@effect/vitest";
import {
  ADW_WORKER_PROTOCOL_VERSION,
  AdwWorkerAdwStatus,
  AdwWorkerCapability,
  AdwWorkerFrameKind,
  AdwWorkerHandshakeKind,
  AdwWorkerIsolation,
  AdwWorkerProgressKind,
  AdwWorkerSandboxFeature,
  AdwWorkerStep,
  AdwWorkerSupportLevel,
  AdwWorkerTerminalKind,
} from "@lazy-software-factory/adw-worker";
import { Effect, Fiber, Layer, Ref } from "effect";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SandboxBusyError } from "./errors.ts";
import { SandboxProvider } from "./sandbox-provider.ts";

export interface ConformanceExpectations {
  readonly isolation:
    typeof AdwWorkerIsolation.Host | typeof AdwWorkerIsolation.Container;
  readonly maxConcurrentLeases: number;
  /** When true, second concurrent acquire must succeed (Docker). */
  readonly supportsParallelAllocation: boolean;
  /** When true, hard CPU limits are accepted and appear on effective.limits. */
  readonly supportsResourceLimits: boolean;
  readonly diskQuota: typeof AdwWorkerSupportLevel.Unsupported;
  readonly retainedWorkspaces: typeof AdwWorkerSupportLevel.Unsupported;
  /**
   * When true, run worker protocol / cancel tests. Requires a Layer that can
   * launch a stub worker (Host). Docker fake-CLI suites leave this false;
   * live Docker integration covers real workers.
   */
  readonly runWorkerTests: boolean;
}

const minimalHard = [AdwWorkerCapability.WorkspaceExec] as const;

const stubWorkerSource = `#!/usr/bin/env node
import * as readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin, terminal: false });
const write = (obj) => {
  process.stdout.write(JSON.stringify(obj) + "\\n");
};
const lines = [];
rl.on("line", (line) => {
  lines.push(line);
  if (lines.length === 1) {
    write({
      protocolVersion: ${ADW_WORKER_PROTOCOL_VERSION},
      kind: "${AdwWorkerFrameKind.HandshakeOk}",
    });
  } else if (lines.length === 2) {
    write({
      protocolVersion: ${ADW_WORKER_PROTOCOL_VERSION},
      kind: "${AdwWorkerFrameKind.Progress}",
      event: {
        kind: "${AdwWorkerProgressKind.StepEnter}",
        step: "${AdwWorkerStep.Provision}",
      },
    });
    write({
      protocolVersion: ${ADW_WORKER_PROTOCOL_VERSION},
      kind: "${AdwWorkerFrameKind.Terminal}",
      outcome: {
        kind: "${AdwWorkerTerminalKind.Completed}",
        result: {
          ticketId: "conformance",
          status: "${AdwWorkerAdwStatus.Shipped}",
          prUrl: "https://example.test/pr/conformance",
        },
        effectiveCapabilities: {
          capabilities: ["${AdwWorkerCapability.WorkspaceExec}"],
          maxConcurrentLeases: 1,
          isolation: "${AdwWorkerIsolation.Host}",
        },
      },
    });
    rl.close();
  }
});
`;

const slowStubWorkerSource = `#!/usr/bin/env node
import * as readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin, terminal: false });
const write = (obj) => {
  process.stdout.write(JSON.stringify(obj) + "\\n");
};
rl.on("line", (line) => {
  if (line.includes('"${AdwWorkerHandshakeKind.Handshake}"')) {
    write({
      protocolVersion: ${ADW_WORKER_PROTOCOL_VERSION},
      kind: "${AdwWorkerFrameKind.HandshakeOk}",
    });
  } else {
    setTimeout(() => {}, 60_000);
  }
});
`;

export const describeSandboxProviderConformance = (options: {
  readonly name: string;
  readonly layer: Layer.Layer<SandboxProvider, never, never>;
  readonly expectations: ConformanceExpectations;
  /** Optional Host worker launch override builder (writes stub scripts). */
  readonly withStubWorkerLayer?: (
    stubPath: string
  ) => Layer.Layer<SandboxProvider, never, never>;
}) => {
  const { expectations } = options;

  describe(`SandboxProvider conformance: ${options.name}`, () => {
    it.effect(
      "rejects unsupported hard disk_quota before allocation work",
      () =>
        Effect.gen(function* () {
          const provider = yield* SandboxProvider;
          const result = yield* Effect.scoped(
            provider.acquire({
              requirements: {
                hard: [...minimalHard],
                hardFeatures: [AdwWorkerSandboxFeature.DiskQuota],
              },
            })
          ).pipe(Effect.exit);
          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.isTrue(
              String(result.cause).includes(
                AdwWorkerSandboxFeature.DiskQuota
              ) || String(result.cause).includes("SandboxCapabilityError")
            );
          }
        }).pipe(Effect.provide(options.layer))
    );

    it.effect("reports unmet soft features on effective metadata", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const provider = yield* SandboxProvider;
          const lease = yield* provider.acquire({
            requirements: {
              hard: [...minimalHard],
              softFeatures: [AdwWorkerSandboxFeature.RetainedWorkspaces],
            },
          });
          assert.strictEqual(
            lease.effectiveCapabilities.isolation,
            expectations.isolation
          );
          assert.strictEqual(
            lease.effectiveCapabilities.maxConcurrentLeases,
            expectations.maxConcurrentLeases
          );
          assert.strictEqual(
            lease.effectiveCapabilities.diskQuota,
            expectations.diskQuota
          );
          assert.strictEqual(
            lease.effectiveCapabilities.retainedWorkspaces,
            expectations.retainedWorkspaces
          );
          assert.deepStrictEqual(
            lease.effectiveCapabilities.unmetSoftFeatures,
            [AdwWorkerSandboxFeature.RetainedWorkspaces]
          );
        })
      ).pipe(Effect.provide(options.layer))
    );

    if (expectations.supportsResourceLimits) {
      it.effect("accepts hard CPU/memory/PID/lifetime and reports limits", () =>
        Effect.scoped(
          Effect.gen(function* () {
            const provider = yield* SandboxProvider;
            const lease = yield* provider.acquire({
              requirements: {
                hard: [...minimalHard],
                hardLimits: {
                  cpu: 1,
                  memoryBytes: 64 * 1024 * 1024,
                  pidsLimit: 32,
                  lifetimeMs: 60_000,
                },
              },
            });
            assert.strictEqual(lease.effectiveCapabilities.limits?.cpu, 1);
            assert.strictEqual(
              lease.effectiveCapabilities.limits?.memoryBytes,
              64 * 1024 * 1024
            );
            assert.strictEqual(
              lease.effectiveCapabilities.limits?.pidsLimit,
              32
            );
            assert.strictEqual(
              lease.effectiveCapabilities.limits?.lifetimeMs,
              60_000
            );
          })
        ).pipe(Effect.provide(options.layer))
      );
    } else {
      it.effect("rejects hard resource limits Host cannot enforce", () =>
        Effect.gen(function* () {
          const result = yield* Effect.scoped(
            Effect.gen(function* () {
              const provider = yield* SandboxProvider;
              return yield* provider.acquire({
                requirements: {
                  hard: [...minimalHard],
                  hardLimits: { cpu: 1 },
                },
              });
            })
          ).pipe(Effect.exit);
          assert.strictEqual(result._tag, "Failure");
        }).pipe(Effect.provide(options.layer))
      );
    }

    it.effect("idempotent release leaves capacity free for a new lease", () =>
      Effect.gen(function* () {
        const provider = yield* SandboxProvider;
        yield* Effect.scoped(
          Effect.gen(function* () {
            const lease = yield* provider.acquire({
              requirements: { hard: [...minimalHard] },
            });
            yield* lease.release();
            yield* lease.release();
          })
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const again = yield* provider.acquire({
              requirements: { hard: [...minimalHard] },
            });
            assert.isString(again.id);
          })
        );
      }).pipe(Effect.provide(options.layer))
    );

    if (expectations.supportsParallelAllocation) {
      it.effect("allocates two leases concurrently up to capacity", () =>
        Effect.scoped(
          Effect.gen(function* () {
            const provider = yield* SandboxProvider;
            const a = yield* provider.acquire({
              requirements: { hard: [...minimalHard] },
            });
            const b = yield* provider.acquire({
              requirements: { hard: [...minimalHard] },
            });
            assert.notStrictEqual(a.id, b.id);
          })
        ).pipe(Effect.provide(options.layer))
      );

      it.effect("returns Busy immediately when capacity is exhausted", () =>
        Effect.gen(function* () {
          const result = yield* Effect.scoped(
            Effect.gen(function* () {
              const provider = yield* SandboxProvider;
              const leases = [];
              for (let i = 0; i < expectations.maxConcurrentLeases; i++) {
                leases.push(
                  yield* provider.acquire({
                    requirements: { hard: [...minimalHard] },
                  })
                );
              }
              assert.strictEqual(
                leases.length,
                expectations.maxConcurrentLeases
              );
              return yield* provider
                .acquire({ requirements: { hard: [...minimalHard] } })
                .pipe(Effect.exit);
            })
          );
          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.isTrue(
              String(result.cause).includes(SandboxBusyError.name) ||
                String(result.cause).includes("SandboxBusyError") ||
                String(result.cause).includes("capacity")
            );
          }
        }).pipe(Effect.provide(options.layer))
      );
    } else {
      it.effect("Host capacity one: second acquire is Busy", () =>
        Effect.gen(function* () {
          const result = yield* Effect.scoped(
            Effect.gen(function* () {
              const provider = yield* SandboxProvider;
              yield* provider.acquire({
                requirements: { hard: [...minimalHard] },
              });
              return yield* provider
                .acquire({ requirements: { hard: [...minimalHard] } })
                .pipe(Effect.exit);
            })
          );
          assert.strictEqual(result._tag, "Failure");
        }).pipe(Effect.provide(options.layer))
      );
    }

    if (expectations.runWorkerTests && options.withStubWorkerLayer) {
      it.live(
        "one worker run: progress decode + completed terminal",
        () =>
          Effect.gen(function* () {
            const dir = yield* Effect.tryPromise(() =>
              mkdtemp(join(tmpdir(), "sandbox-conformance-"))
            );
            const stubPath = join(dir, "stub-worker.mjs");
            yield* Effect.tryPromise(() =>
              writeFile(stubPath, stubWorkerSource)
            );

            const layer = options.withStubWorkerLayer!(stubPath);
            const events = yield* Ref.make<string[]>([]);

            const outcome = yield* Effect.scoped(
              Effect.gen(function* () {
                const provider = yield* SandboxProvider;
                const lease = yield* provider.acquire({
                  requirements: { hard: [...minimalHard] },
                });
                return yield* lease.runWorker(
                  {
                    protocolVersion: ADW_WORKER_PROTOCOL_VERSION,
                    ticketId: "conformance",
                    prompt: "stub",
                    cwd: process.cwd(),
                  },
                  {
                    onProgress: (event) =>
                      Ref.update(events, (xs) => [...xs, event.kind]),
                  }
                );
              })
            ).pipe(Effect.provide(layer));

            assert.strictEqual(outcome.kind, AdwWorkerTerminalKind.Completed);
            const seen = yield* Ref.get(events);
            assert.isTrue(seen.includes(AdwWorkerProgressKind.StepEnter));
          }),
        { timeout: 30_000 }
      );

      it.live(
        "cancellation stops worker and releases the capacity slot",
        () =>
          Effect.gen(function* () {
            const dir = yield* Effect.tryPromise(() =>
              mkdtemp(join(tmpdir(), "sandbox-conformance-cancel-"))
            );
            const stubPath = join(dir, "slow-stub-worker.mjs");
            yield* Effect.tryPromise(() =>
              writeFile(stubPath, slowStubWorkerSource)
            );

            const layer = options.withStubWorkerLayer!(stubPath);

            const fiber = yield* Effect.forkChild(
              Effect.scoped(
                Effect.gen(function* () {
                  const provider = yield* SandboxProvider;
                  const lease = yield* provider.acquire({
                    requirements: { hard: [...minimalHard] },
                  });
                  return yield* lease.runWorker(
                    {
                      protocolVersion: ADW_WORKER_PROTOCOL_VERSION,
                      ticketId: "conformance-cancel",
                      prompt: "stub",
                      cwd: process.cwd(),
                    },
                    { onProgress: () => Effect.void }
                  );
                })
              ).pipe(Effect.provide(layer))
            );
            yield* Effect.sleep("100 millis");
            yield* Fiber.interrupt(fiber);
            const exit = yield* Fiber.await(fiber);
            assert.isTrue(
              exit._tag === "Failure",
              "interrupted worker run must not complete successfully"
            );

            // Capacity free again after cancel releases the Host slot.
            yield* Effect.scoped(
              Effect.gen(function* () {
                const provider = yield* SandboxProvider;
                const again = yield* provider.acquire({
                  requirements: { hard: [...minimalHard] },
                });
                assert.isString(again.id);
              })
            ).pipe(Effect.provide(layer));
          }),
        { timeout: 30_000 }
      );
    }
  });
};
