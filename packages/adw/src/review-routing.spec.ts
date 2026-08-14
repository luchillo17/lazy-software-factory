import { assert, describe, it } from "@effect/vitest";
import {
  BuildAgentProvider,
  ReviewAgentProvider,
  SandboxProvider,
  type AgentSession,
  type Sandbox,
} from "@lazy-software-factory/runtime";
import { Effect, Layer, Ref } from "effect";
import {
  AdwBuildAttemptCap,
  AdwReviewAttemptCap,
  AdwSchemaResumeCap,
} from "./attempt-caps.ts";
import { AdwStatus } from "./enums.ts";
import { GitHost } from "./git-host.ts";
import { runMinimalAdw } from "./run-minimal-adw.ts";
import {
  submitReviewFailViaTools,
  submitReviewPassViaTools,
} from "./review-tool-test-helpers.ts";
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
      commitWorkingTree: () => Effect.void,
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
            run: (options) =>
              Effect.gen(function* () {
                const pass = yield* Ref.get(reviewPass);
                const id = pass ? "review-session-2" : "review-session-1";
                yield* Ref.update(reviewIds, (ids) => [...ids, id]);
                if (!pass) {
                  yield* Ref.set(reviewPass, true);
                  yield* submitReviewFailViaTools(
                    options,
                    "needs changes: find X"
                  );
                  return { sessionId: id };
                }
                yield* submitReviewPassViaTools(options);
                return { sessionId: id };
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
                AdwTestCommands.of({
                  resolve: () => [{ command: "t" }],
                })
              ),
              Layer.succeed(
                AdwBuildAttemptCap,
                AdwBuildAttemptCap.of({ maxAttempts: 2 })
              ),
              AdwReviewAttemptCap.Default,
              AdwSchemaResumeCap.Default
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

  it.effect("Review create prompt includes submit tool wire contract", () =>
    Effect.gen(function* () {
      const createPrompt = yield* Ref.make<string | undefined>(undefined);

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
          resume: () => Effect.die("Build must not resume"),
        })
      );

      const reviewLayer = Layer.succeed(
        ReviewAgentProvider,
        ReviewAgentProvider.of({
          run: (options) =>
            Effect.gen(function* () {
              yield* Ref.set(createPrompt, options.prompt);
              yield* submitReviewPassViaTools(options);
              return { sessionId: "review-session-1" };
            }),
          resume: () => Effect.die("Review must not resume"),
        })
      );

      const result = yield* runMinimalAdw({
        ticketId: "T-CONTRACT",
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
              AdwTestCommands.of({
                resolve: () => [{ command: "t" }],
              })
            ),
            AdwBuildAttemptCap.Default,
            AdwReviewAttemptCap.Default,
            AdwSchemaResumeCap.Default
          )
        )
      );

      assert.strictEqual(result.status, AdwStatus.Shipped);
      const prompt = yield* Ref.get(createPrompt);
      assert.isTrue(prompt !== undefined);
      assert.isTrue(prompt!.includes("submit_review_pass"));
      assert.isTrue(prompt!.includes("submit_review_fail"));
      assert.isTrue(prompt!.includes("/adw-review"));
      assert.isTrue(prompt!.includes("## Ticket"));
      assert.isTrue(prompt!.includes("work"));
    })
  );

  it.effect(
    "wire miss resumes same Review session until tool pass without Build resume",
    () =>
      Effect.gen(function* () {
        const reviewCreates = yield* Ref.make(0);
        const reviewResumes = yield* Ref.make<string[]>([]);
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
            run: () => Effect.succeed({ sessionId: "build-session-1" }),
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
              Effect.gen(function* () {
                yield* Ref.update(reviewCreates, (n) => n + 1);
                return {
                  sessionId: "review-session-1",
                  output: { notAVerdict: true },
                };
              }),
            resume: (session, options) =>
              Effect.gen(function* () {
                assert.strictEqual(session.sessionId, "review-session-1");
                yield* Ref.update(reviewResumes, (rs) => [
                  ...rs,
                  options.prompt,
                ]);
                yield* submitReviewPassViaTools(options);
                return { sessionId: session.sessionId };
              }),
          })
        );

        const result = yield* runMinimalAdw({
          ticketId: "T-WIRE-REPAIR",
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
                AdwTestCommands.of({
                  resolve: () => [{ command: "t" }],
                })
              ),
              AdwBuildAttemptCap.Default,
              Layer.succeed(
                AdwReviewAttemptCap,
                AdwReviewAttemptCap.of({ maxAttempts: 1 })
              ),
              AdwSchemaResumeCap.Default
            )
          )
        );

        assert.strictEqual(result.status, AdwStatus.Shipped);
        assert.strictEqual(result.reviewSessionId, "review-session-1");
        assert.strictEqual(yield* Ref.get(reviewCreates), 1);
        assert.strictEqual(yield* Ref.get(buildResumes), 0);
        const resumes = yield* Ref.get(reviewResumes);
        assert.strictEqual(resumes.length, 1);
        assert.isTrue(resumes[0]!.includes("wire miss"));
        assert.isTrue(resumes[0]!.includes("submit_review_pass"));
        assert.isTrue(resumes[0]!.includes("submit_review_fail"));
      })
  );

  it.effect("missing submit tool is wire miss and resumes to valid pass", () =>
    Effect.gen(function* () {
      const reviewResumes = yield* Ref.make(0);

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
          resume: () => Effect.die("Build must not resume on PR-draft miss"),
        })
      );

      const reviewLayer = Layer.succeed(
        ReviewAgentProvider,
        ReviewAgentProvider.of({
          run: () =>
            Effect.succeed({
              sessionId: "review-session-1",
            }),
          resume: (session, options) =>
            Effect.gen(function* () {
              yield* Ref.update(reviewResumes, (n) => n + 1);
              yield* submitReviewPassViaTools(options);
              return { sessionId: session.sessionId };
            }),
        })
      );

      const result = yield* runMinimalAdw({
        ticketId: "T-PASS-DRAFT",
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
              AdwTestCommands.of({
                resolve: () => [{ command: "t" }],
              })
            ),
            AdwBuildAttemptCap.Default,
            AdwReviewAttemptCap.Default,
            AdwSchemaResumeCap.Default
          )
        )
      );

      assert.strictEqual(result.status, AdwStatus.Shipped);
      assert.strictEqual(yield* Ref.get(reviewResumes), 1);
    })
  );

  it.effect(
    "wire miss then valid fail resumes Build with fail report only",
    () =>
      Effect.gen(function* () {
        const buildResumes = yield* Ref.make<string[]>([]);
        const reviewCreates = yield* Ref.make(0);
        const reviewPass = yield* Ref.make(false);

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
            resume: (session, options) =>
              Effect.gen(function* () {
                yield* Ref.update(buildResumes, (rs) => [
                  ...rs,
                  options.prompt,
                ]);
                if (options.prompt.includes("needs changes: find Y")) {
                  yield* Ref.set(reviewPass, true);
                }
                return session;
              }),
          })
        );

        const reviewLayer = Layer.succeed(
          ReviewAgentProvider,
          ReviewAgentProvider.of({
            run: (options) =>
              Effect.gen(function* () {
                yield* Ref.update(reviewCreates, (n) => n + 1);
                const pass = yield* Ref.get(reviewPass);
                if (pass) {
                  yield* submitReviewPassViaTools(options);
                  return { sessionId: "review-session-2" };
                }
                return { sessionId: "review-session-1" };
              }),
            resume: (session, options) =>
              Effect.gen(function* () {
                yield* submitReviewFailViaTools(
                  options,
                  "needs changes: find Y"
                );
                return { sessionId: session.sessionId };
              }),
          })
        );

        const result = yield* runMinimalAdw({
          ticketId: "T-WIRE-FAIL",
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
                AdwTestCommands.of({
                  resolve: () => [{ command: "t" }],
                })
              ),
              AdwBuildAttemptCap.Default,
              AdwReviewAttemptCap.Default,
              AdwSchemaResumeCap.Default
            )
          )
        );

        assert.strictEqual(result.status, AdwStatus.Shipped);
        assert.strictEqual(yield* Ref.get(reviewCreates), 2);
        const resumes = yield* Ref.get(buildResumes);
        assert.strictEqual(resumes.length, 1);
        assert.strictEqual(resumes[0], "needs changes: find Y");
        assert.isFalse(resumes[0]!.includes("malformed-first"));
      })
  );

  it.effect(
    "wire resume cap exhaust fails ADW without sending malformed blob to Build",
    () =>
      Effect.gen(function* () {
        const buildResumes = yield* Ref.make<string[]>([]);
        const reviewResumes = yield* Ref.make(0);

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
            resume: (session, options) =>
              Effect.gen(function* () {
                yield* Ref.update(buildResumes, (rs) => [
                  ...rs,
                  options.prompt,
                ]);
                return session;
              }),
          })
        );

        const reviewLayer = Layer.succeed(
          ReviewAgentProvider,
          ReviewAgentProvider.of({
            run: () =>
              Effect.succeed({
                sessionId: "review-session-1",
                output: "raw-malformed-blob-should-not-reach-build",
              }),
            resume: (session) =>
              Effect.gen(function* () {
                yield* Ref.update(reviewResumes, (n) => n + 1);
                return {
                  sessionId: session.sessionId,
                  output: "still-bad",
                };
              }),
          })
        );

        const result = yield* runMinimalAdw({
          ticketId: "T-WIRE-CAP",
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
                AdwTestCommands.of({
                  resolve: () => [{ command: "t" }],
                })
              ),
              AdwBuildAttemptCap.Default,
              Layer.succeed(
                AdwReviewAttemptCap,
                AdwReviewAttemptCap.of({ maxAttempts: 3 })
              ),
              Layer.succeed(
                AdwSchemaResumeCap,
                AdwSchemaResumeCap.of({ maxAttempts: 2 })
              )
            )
          )
        );

        assert.strictEqual(result.status, AdwStatus.Failed);
        assert.isTrue(result.detail?.includes("wire-miss resume"));
        assert.isFalse(
          result.detail?.includes("raw-malformed-blob-should-not-reach-build")
        );
        assert.strictEqual(yield* Ref.get(reviewResumes), 2);
        assert.deepStrictEqual(yield* Ref.get(buildResumes), []);
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
          run: (options) =>
            Effect.gen(function* () {
              yield* submitReviewFailViaTools(options, "still wrong");
              return { sessionId: "review-session" };
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
              AdwTestCommands.of({
                resolve: () => [{ command: "t" }],
              })
            ),
            Layer.succeed(
              AdwBuildAttemptCap,
              AdwBuildAttemptCap.of({ maxAttempts: 5 })
            ),
            Layer.succeed(
              AdwReviewAttemptCap,
              AdwReviewAttemptCap.of({ maxAttempts: 2 })
            ),
            AdwSchemaResumeCap.Default
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
