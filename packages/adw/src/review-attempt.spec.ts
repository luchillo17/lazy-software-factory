import { assert, describe, it } from "@effect/vitest";
import type {
  AgentProviderService,
  AgentSession,
  Sandbox,
} from "@lazy-software-factory/runtime";
import { Effect, Logger, Ref } from "effect";
import { captureAdwProgressLogger } from "./adw-progress.ts";
import { ReviewVerdict } from "./enums.ts";
import { ReviewAttemptOutcome, runReviewAttempt } from "./review-attempt.ts";
import { reviewPassFixture } from "./review-pass-fixture.ts";

const sandbox: Sandbox = {
  id: "sandbox-1",
  cwd: "/tmp",
  exec: () => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
  destroy: () => Effect.void,
};

const session = (
  output: unknown,
  sessionId = "review-session-1"
): AgentSession => ({
  sessionId,
  output,
});

describe("runReviewAttempt", () => {
  it.effect("returns pass when Review output is a pass verdict", () =>
    Effect.gen(function* () {
      const reviewAgent: AgentProviderService = {
        run: () => Effect.succeed(session(reviewPassFixture())),
        resume: () => Effect.die("unused"),
      };
      const result = yield* runReviewAttempt({
        reviewAgent,
        sandbox,
        ticketId: "T-1",
        schemaResumeCap: 2,
        buildAttempts: 1,
        reviewAttempts: 0,
      });
      assert.strictEqual(result.outcome, ReviewAttemptOutcome.Pass);
      if (result.outcome === ReviewAttemptOutcome.Pass) {
        assert.strictEqual(result.sessionId, "review-session-1");
        assert.strictEqual(result.reviewAttempts, 1);
        assert.strictEqual(result.pass.verdict, ReviewVerdict.Pass);
        assert.strictEqual(result.pass.prTitle, "feat: adw ticket");
      }
    })
  );

  it.effect("returns fail with failReport on fail verdict", () =>
    Effect.gen(function* () {
      const reviewAgent: AgentProviderService = {
        run: () =>
          Effect.succeed(
            session({
              verdict: ReviewVerdict.Fail,
              failReport: "missing tests",
            })
          ),
        resume: () => Effect.die("unused"),
      };
      const result = yield* runReviewAttempt({
        reviewAgent,
        sandbox,
        ticketId: "T-1",
        schemaResumeCap: 2,
        buildAttempts: 1,
        reviewAttempts: 1,
      });
      assert.strictEqual(result.outcome, ReviewAttemptOutcome.Fail);
      if (result.outcome === ReviewAttemptOutcome.Fail) {
        assert.strictEqual(result.failReport, "missing tests");
        assert.strictEqual(result.reviewAttempts, 2);
      }
    })
  );

  it.effect("schema-resumes until valid output within cap", () =>
    Effect.gen(function* () {
      const resumes = yield* Ref.make(0);
      const reviewAgent: AgentProviderService = {
        run: () => Effect.succeed(session({ not: "review" })),
        resume: (prev) =>
          Effect.gen(function* () {
            yield* Ref.update(resumes, (n) => n + 1);
            return session(reviewPassFixture(), prev.sessionId);
          }),
      };
      const result = yield* runReviewAttempt({
        reviewAgent,
        sandbox,
        ticketId: "T-1",
        schemaResumeCap: 2,
        buildAttempts: 1,
        reviewAttempts: 0,
      });
      assert.strictEqual(result.outcome, ReviewAttemptOutcome.Pass);
      assert.strictEqual(yield* Ref.get(resumes), 1);
    })
  );

  it.effect("returns schemaCapExhausted when resumes exceed cap", () =>
    Effect.gen(function* () {
      const reviewAgent: AgentProviderService = {
        run: () => Effect.succeed(session({ not: "review" })),
        resume: (prev) =>
          Effect.succeed(session({ still: "bad" }, prev.sessionId)),
      };
      const result = yield* runReviewAttempt({
        reviewAgent,
        sandbox,
        ticketId: "T-1",
        schemaResumeCap: 1,
        buildAttempts: 1,
        reviewAttempts: 0,
      });
      assert.strictEqual(
        result.outcome,
        ReviewAttemptOutcome.SchemaCapExhausted
      );
      if (result.outcome === ReviewAttemptOutcome.SchemaCapExhausted) {
        assert.isTrue(result.detail.includes("1"));
        assert.strictEqual(result.sessionId, "review-session-1");
        assert.strictEqual(result.reviewAttempts, 1);
      }
    })
  );

  it.effect("emits Review StepEnter/ok and SchemaMiss on resume path", () =>
    Effect.gen(function* () {
      const lines: string[] = [];
      const reviewAgent: AgentProviderService = {
        run: () => Effect.succeed(session({ not: "review" })),
        resume: (prev) =>
          Effect.succeed(session(reviewPassFixture(), prev.sessionId)),
      };
      yield* runReviewAttempt({
        reviewAgent,
        sandbox,
        ticketId: "T-1",
        schemaResumeCap: 2,
        buildAttempts: 1,
        reviewAttempts: 0,
      }).pipe(Effect.provide(Logger.layer([captureAdwProgressLogger(lines)])));

      assert.isTrue(
        lines.some((l) => l.includes("step_enter") && l.includes("review"))
      );
      assert.isTrue(lines.some((l) => l.includes("schema_miss")));
      assert.isTrue(
        lines.some(
          (l) =>
            l.includes("step_result") &&
            l.includes("review") &&
            l.includes("result=ok")
        )
      );
    })
  );
});
