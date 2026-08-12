import { assert, describe, it } from "@effect/vitest";
import {
  BuildAgentProvider,
  ReviewAgentProvider,
  SandboxProvider,
  type Sandbox,
} from "@lazy-software-factory/runtime";
import { Effect, Layer, Logger } from "effect";
import { captureAdwProgressLogger } from "./adw-progress.ts";
import {
  AdwBuildAttemptCap,
  AdwReviewAttemptCap,
  AdwSchemaResumeCap,
} from "./attempt-caps.ts";
import { AdwStatus, ReviewVerdict } from "./enums.ts";
import { GitHost } from "./git-host.ts";
import { monorepoRoot } from "./monorepo-root.ts";
import { runMinimalAdw } from "./run-minimal-adw.ts";
import { AdwTestCommands } from "./test-commands.ts";
import { WorkspaceProvision } from "./workspace-provision.ts";

describe("runMinimalAdw progress events", () => {
  it.effect("emits step enter/result through Effect Logger on happy path", () =>
    Effect.gen(function* () {
      const lines: string[] = [];

      const fakeSandboxLayer = Layer.succeed(
        SandboxProvider,
        SandboxProvider.of({
          create: () =>
            Effect.succeed({
              id: "sandbox-1",
              cwd: monorepoRoot,
              exec: (command, args = []) => {
                if (command === "git" && args[0] === "rev-parse") {
                  return Effect.succeed({
                    exitCode: 0,
                    stdout: ".git\n",
                    stderr: "",
                  });
                }
                if (command === "git" && args[0] === "checkout") {
                  return Effect.succeed({
                    exitCode: 0,
                    stdout: "",
                    stderr: "",
                  });
                }
                if (command === "test" && args[0] === "-f") {
                  return Effect.succeed({
                    exitCode: args[1] === "pnpm-lock.yaml" ? 0 : 1,
                    stdout: "",
                    stderr: "",
                  });
                }
                if (command === "pnpm") {
                  return Effect.succeed({
                    exitCode: 0,
                    stdout: "",
                    stderr: "",
                  });
                }
                return Effect.succeed({
                  exitCode: 0,
                  stdout: "",
                  stderr: "",
                });
              },
              destroy: () => Effect.void,
            } satisfies Sandbox),
        })
      );

      const result = yield* runMinimalAdw({
        ticketId: "T-PROG",
        prompt: "work",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            fakeSandboxLayer,
            Layer.succeed(
              BuildAgentProvider,
              BuildAgentProvider.of({
                run: () => Effect.succeed({ sessionId: "build-1" }),
                resume: () => Effect.die("unused"),
              })
            ),
            Layer.succeed(
              ReviewAgentProvider,
              ReviewAgentProvider.of({
                run: () =>
                  Effect.succeed({
                    sessionId: "review-1",
                    output: { verdict: ReviewVerdict.Pass },
                  }),
                resume: () => Effect.die("unused"),
              })
            ),
            Layer.succeed(
              GitHost,
              GitHost.of({
                commitWorkingTree: () => Effect.void,
                ensureRepo: () => Effect.void,
                push: () => Effect.void,
                openPullRequest: () =>
                  Effect.succeed({ url: "https://example.test/pr/1" }),
              })
            ),
            WorkspaceProvision.Host.pipe(
              Layer.provide(
                Layer.succeed(
                  GitHost,
                  GitHost.of({
                    commitWorkingTree: () => Effect.void,
                    ensureRepo: () => Effect.void,
                    push: () => Effect.void,
                    openPullRequest: () =>
                      Effect.succeed({ url: "https://example.test/pr/1" }),
                  })
                )
              )
            ),
            Layer.succeed(
              AdwTestCommands,
              AdwTestCommands.of({
                commands: [
                  { command: "node", args: ["-e", "process.exit(0)"] },
                ],
              })
            ),
            AdwBuildAttemptCap.Default,
            AdwReviewAttemptCap.Default,
            AdwSchemaResumeCap.Default,
            Logger.layer([captureAdwProgressLogger(lines)])
          )
        )
      );

      assert.strictEqual(result.status, AdwStatus.Shipped);
      assert.isTrue(
        lines.some((l) => l.includes("kind=step_enter step=provision"))
      );
      assert.isTrue(
        lines.some((l) => l.includes("kind=step_enter step=build"))
      );
      assert.isTrue(lines.some((l) => l.includes("kind=step_enter step=test")));
      assert.isTrue(
        lines.some((l) => l.includes("kind=step_enter step=review"))
      );
      assert.isTrue(lines.some((l) => l.includes("kind=step_enter step=ship")));
      assert.isTrue(
        lines.some((l) => l.includes("kind=step_result step=ship result=ok"))
      );
    })
  );

  it.effect("emits schema_miss with raw on malformed Review output", () =>
    Effect.gen(function* () {
      const lines: string[] = [];

      const fakeSandboxLayer = Layer.succeed(
        SandboxProvider,
        SandboxProvider.of({
          create: () =>
            Effect.succeed({
              id: "sandbox-1",
              cwd: monorepoRoot,
              exec: () =>
                Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
              destroy: () => Effect.void,
            } satisfies Sandbox),
        })
      );

      const provisionLayer = Layer.succeed(
        WorkspaceProvision,
        WorkspaceProvision.of({
          provision: () => Effect.void,
        })
      );

      const result = yield* runMinimalAdw({
        ticketId: "T-SCHEMA-MISS",
        prompt: "work",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            fakeSandboxLayer,
            provisionLayer,
            Layer.succeed(
              BuildAgentProvider,
              BuildAgentProvider.of({
                run: () => Effect.succeed({ sessionId: "build-1" }),
                resume: (session) => Effect.succeed(session),
              })
            ),
            Layer.succeed(
              ReviewAgentProvider,
              ReviewAgentProvider.of({
                run: () =>
                  Effect.succeed({
                    sessionId: "review-1",
                    output:
                      "not-a-verdict gho_abcdefghijklmnopqrstuvwxyz012345",
                  }),
                resume: (session) =>
                  Effect.succeed({
                    sessionId: session.sessionId,
                    output: "still-not-a-verdict",
                  }),
              })
            ),
            Layer.succeed(
              GitHost,
              GitHost.of({
                commitWorkingTree: () => Effect.void,
                ensureRepo: () => Effect.void,
                push: () => Effect.void,
                openPullRequest: () =>
                  Effect.succeed({ url: "https://example.test/pr/1" }),
              })
            ),
            Layer.succeed(
              AdwTestCommands,
              AdwTestCommands.of({ commands: [{ command: "t" }] })
            ),
            Layer.succeed(
              AdwBuildAttemptCap,
              AdwBuildAttemptCap.of({ maxAttempts: 5 })
            ),
            Layer.succeed(
              AdwReviewAttemptCap,
              AdwReviewAttemptCap.of({ maxAttempts: 1 })
            ),
            Layer.succeed(
              AdwSchemaResumeCap,
              AdwSchemaResumeCap.of({ maxAttempts: 1 })
            ),
            Logger.layer([captureAdwProgressLogger(lines)])
          )
        )
      );

      assert.strictEqual(result.status, AdwStatus.Failed);
      assert.isTrue(result.detail?.includes("schema resume cap exhausted"));
      const miss = lines.find((l) => l.includes("kind=schema_miss"));
      assert.isTrue(miss !== undefined);
      assert.isTrue(miss!.includes("raw="));
      assert.isFalse(miss!.includes("gho_"));
      assert.isTrue(miss!.includes("[REDACTED]"));
      assert.isTrue(
        lines.some((l) =>
          l.includes("kind=step_result step=review result=schema_resume")
        )
      );
    })
  );
});
