import { assert, describe, it } from "@effect/vitest";
import {
  BuildAgentProvider,
  ReviewAgentProvider,
  SandboxProvider,
  type AgentSession,
  type Sandbox,
} from "@lazy-software-factory/runtime";
import { Effect, Layer, Ref } from "effect";
import { AdwBuildAttemptCap, AdwReviewAttemptCap } from "./attempt-caps.ts";
import { AdwStatus, ReviewVerdict } from "./enums.ts";
import { GitHost } from "./git-host.ts";
import { runMinimalAdw } from "./run-minimal-adw.ts";
import { AdwTestCommands } from "./test-commands.ts";
import { WorkspaceProvision } from "./workspace-provision.ts";
import { monorepoRoot } from "./monorepo-root.ts";

const provisionAndShip = Layer.mergeAll(
  Layer.succeed(
    WorkspaceProvision,
    WorkspaceProvision.of({ provision: () => Effect.void })
  ),
  Layer.succeed(
    GitHost,
    GitHost.of({
      clone: () => Effect.void,
      push: () => Effect.void,
      openPullRequest: () =>
        Effect.succeed({ url: "https://example.test/pr/1" }),
    })
  )
);

describe("runMinimalAdw Review routing + cap", () => {
  it.effect(
    "Review fail resumes Build with fail report without spending Build attempts",
    () =>
      Effect.gen(function* () {
        const buildResumes = yield* Ref.make<string[]>([]);
        const reviewIds = yield* Ref.make<string[]>([]);
        const testPhase = yield* Ref.make(0);
        // phases: 0 first green, 1 fail after review→build, 2 green again

        const sandboxLayer = Layer.succeed(
          SandboxProvider,
          SandboxProvider.of({
            create: () =>
              Effect.succeed({
                id: "sandbox-1",
                cwd: monorepoRoot,
                exec: () =>
                  Effect.gen(function* () {
                    const phase = yield* Ref.get(testPhase);
                    if (phase === 1) {
                      yield* Ref.set(testPhase, 2);
                      return {
                        exitCode: 1,
                        stdout: "",
                        stderr: "test red after review fix",
                      };
                    }
                    return { exitCode: 0, stdout: "ok", stderr: "" };
                  }),
                destroy: () => Effect.void,
              } satisfies Sandbox),
          })
        );

        const buildLayer = Layer.succeed(
          BuildAgentProvider,
          BuildAgentProvider.of({
            run: () => Effect.succeed({ sessionId: "build-session-1" }),
            resume: (session, options) =>
              Effect.gen(function* () {
                yield* Ref.update(buildResumes, (rs) => [
                  ...rs,
                  options.prompt,
                ]);
                assert.strictEqual(session.sessionId, "build-session-1");
                if (options.prompt.includes("needs changes")) {
                  yield* Ref.set(testPhase, 1);
                }
                return session;
              }),
          })
        );

        const reviewPass = yield* Ref.make(false);
        const reviewLayer = Layer.succeed(
          ReviewAgentProvider,
          ReviewAgentProvider.of({
            run: () =>
              Effect.gen(function* () {
                const pass = yield* Ref.get(reviewPass);
                const id = pass ? "review-session-2" : "review-session-1";
                yield* Ref.update(reviewIds, (ids) => [...ids, id]);
                if (!pass) {
                  yield* Ref.set(reviewPass, true);
                  return {
                    sessionId: id,
                    output: {
                      verdict: ReviewVerdict.Fail,
                      failReport: "needs changes: find X",
                    },
                  };
                }
                return {
                  sessionId: id,
                  output: { verdict: ReviewVerdict.Pass },
                };
              }),
            resume: () => Effect.die("Review must not resume"),
          })
        );

        const result = yield* runMinimalAdw({
          ticketId: "T-REV",
          prompt: "work",
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              sandboxLayer,
              buildLayer,
              reviewLayer,
              provisionAndShip,
              Layer.succeed(
                AdwTestCommands,
                AdwTestCommands.of({ commands: [{ command: "t" }] })
              ),
              Layer.succeed(
                AdwBuildAttemptCap,
                AdwBuildAttemptCap.of({ maxAttempts: 2 })
              ),
              AdwReviewAttemptCap.Default
            )
          )
        );

        assert.strictEqual(result.status, AdwStatus.Shipped);
        assert.strictEqual(result.buildSessionId, "build-session-1");

        const resumes = yield* Ref.get(buildResumes);
        assert.strictEqual(resumes.length, 2);
        assert.isTrue(resumes[0]!.includes("needs changes"));
        assert.isTrue(resumes[1]!.includes("test red after review fix"));

        const ids = yield* Ref.get(reviewIds);
        assert.deepStrictEqual(ids, ["review-session-1", "review-session-2"]);
        assert.notStrictEqual(ids[0], "build-session-1");
      })
  );

  it.effect(
    "malformed Review verdict spends a Review attempt and can recover",
    () =>
      Effect.gen(function* () {
        const reviewCalls = yield* Ref.make(0);

        const sandboxLayer = Layer.succeed(
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

        const buildLayer = Layer.succeed(
          BuildAgentProvider,
          BuildAgentProvider.of({
            run: () => Effect.succeed({ sessionId: "build-session-1" }),
            resume: (session) => Effect.succeed(session),
          })
        );

        const reviewLayer = Layer.succeed(
          ReviewAgentProvider,
          ReviewAgentProvider.of({
            run: () =>
              Effect.gen(function* () {
                const n = yield* Ref.updateAndGet(reviewCalls, (c) => c + 1);
                if (n === 1) {
                  return {
                    sessionId: "review-bad",
                    output: { notAVerdict: true },
                  };
                }
                return {
                  sessionId: "review-ok",
                  output: { verdict: ReviewVerdict.Pass },
                };
              }),
            resume: () => Effect.die("unused"),
          })
        );

        const result = yield* runMinimalAdw({
          ticketId: "T-MALFORMED",
          prompt: "work",
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              sandboxLayer,
              buildLayer,
              reviewLayer,
              provisionAndShip,
              Layer.succeed(
                AdwTestCommands,
                AdwTestCommands.of({ commands: [{ command: "t" }] })
              ),
              AdwBuildAttemptCap.Default,
              AdwReviewAttemptCap.Default
            )
          )
        );

        assert.strictEqual(result.status, AdwStatus.Shipped);
        assert.strictEqual(yield* Ref.get(reviewCalls), 2);
      })
  );

  it.effect("Review cap exhausts to failed while Build attempts remain", () =>
    Effect.gen(function* () {
      const buildRuns = yield* Ref.make(0);
      const buildResumes = yield* Ref.make(0);

      const sandboxLayer = Layer.succeed(
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

      const buildLayer = Layer.succeed(
        BuildAgentProvider,
        BuildAgentProvider.of({
          run: () =>
            Effect.gen(function* () {
              yield* Ref.update(buildRuns, (n) => n + 1);
              return { sessionId: "build-session-1" } satisfies AgentSession;
            }),
          resume: (session) =>
            Effect.gen(function* () {
              yield* Ref.update(buildResumes, (n) => n + 1);
              return session;
            }),
        })
      );

      const reviewLayer = Layer.succeed(
        ReviewAgentProvider,
        ReviewAgentProvider.of({
          run: () =>
            Effect.succeed({
              sessionId: "review-session",
              output: {
                verdict: ReviewVerdict.Fail,
                failReport: "still wrong",
              },
            }),
          resume: () => Effect.die("unused"),
        })
      );

      const result = yield* runMinimalAdw({
        ticketId: "T-REV-CAP",
        prompt: "work",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            sandboxLayer,
            buildLayer,
            reviewLayer,
            provisionAndShip,
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
              AdwReviewAttemptCap.of({ maxAttempts: 2 })
            )
          )
        )
      );

      assert.strictEqual(result.status, AdwStatus.Failed);
      assert.isTrue(result.detail?.includes("still wrong"));
      assert.strictEqual(yield* Ref.get(buildRuns), 1);
      // Review fail resumes Build once between the two Review attempts
      assert.strictEqual(yield* Ref.get(buildResumes), 1);
    })
  );
});
