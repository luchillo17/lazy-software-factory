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
import {
  submitReviewFailViaTools,
  submitReviewPassViaTools,
} from "./review-tool-test-helpers.ts";

const sandbox: Sandbox = {
  id: "sandbox-1",
  cwd: "/tmp",
  exec: () => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
  destroy: () => Effect.void,
};

const session = (sessionId = "review-session-1"): AgentSession => ({
  sessionId,
});

const workPrompt =
  "# Extractability note\n\n## Acceptance criteria\n\n- Short note exists";

describe("runReviewAttempt", () => {
  it.effect("create prompt includes work prompt for judgment context", () =>
    Effect.gen(function* () {
      const createPrompt = yield* Ref.make<string | undefined>(undefined);
      const reviewAgent: AgentProviderService = {
        run: (options) =>
          Effect.gen(function* () {
            yield* Ref.set(createPrompt, options.prompt);
            yield* submitReviewPassViaTools(options);
            return session();
          }),
        resume: () => Effect.die("unused"),
      };
      yield* runReviewAttempt({
        reviewAgent,
        sandbox,
        ticketId: "39",
        prompt: workPrompt,
        wireMissCap: 2,
        buildAttempts: 1,
        reviewAttempts: 0,
      });
      const prompt = yield* Ref.get(createPrompt);
      assert.isTrue(prompt !== undefined);
      assert.isTrue(prompt!.includes("ADW run `39`"));
      assert.isTrue(prompt!.includes("## Work"));
      assert.isTrue(prompt!.includes("## Acceptance criteria"));
      assert.isTrue(prompt!.includes("Short note exists"));
    })
  );

  it.effect("create prompt accepts plain work text without Issue framing", () =>
    Effect.gen(function* () {
      const createPrompt = yield* Ref.make<string | undefined>(undefined);
      const reviewAgent: AgentProviderService = {
        run: (options) =>
          Effect.gen(function* () {
            yield* Ref.set(createPrompt, options.prompt);
            yield* submitReviewPassViaTools(options);
            return session();
          }),
        resume: () => Effect.die("unused"),
      };
      yield* runReviewAttempt({
        reviewAgent,
        sandbox,
        ticketId: "local-1",
        prompt: "Add a hello world script.",
        wireMissCap: 2,
        buildAttempts: 1,
        reviewAttempts: 0,
      });
      const prompt = yield* Ref.get(createPrompt);
      assert.isTrue(prompt !== undefined);
      assert.isTrue(prompt!.includes("## Work"));
      assert.isTrue(prompt!.includes("Add a hello world script."));
      assert.isFalse(prompt!.includes("## Ticket"));
      assert.isTrue(
        prompt!.includes("acceptance criteria when the prompt includes them")
      );
    })
  );

  it.effect("returns pass when submit_review_pass succeeds", () =>
    Effect.gen(function* () {
      const reviewAgent: AgentProviderService = {
        run: (options) =>
          Effect.gen(function* () {
            yield* submitReviewPassViaTools(options);
            return session();
          }),
        resume: () => Effect.die("unused"),
      };
      const result = yield* runReviewAttempt({
        reviewAgent,
        sandbox,
        ticketId: "T-1",
        prompt: workPrompt,
        wireMissCap: 2,
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

  it.effect("returns fail when submit_review_fail succeeds", () =>
    Effect.gen(function* () {
      const reviewAgent: AgentProviderService = {
        run: (options) =>
          Effect.gen(function* () {
            yield* submitReviewFailViaTools(options, "missing tests");
            return session();
          }),
        resume: () => Effect.die("unused"),
      };
      const result = yield* runReviewAttempt({
        reviewAgent,
        sandbox,
        ticketId: "T-1",
        prompt: workPrompt,
        wireMissCap: 2,
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

  it.effect("ignores prose session.output when no tool was called", () =>
    Effect.gen(function* () {
      const resumes = yield* Ref.make(0);
      const reviewAgent: AgentProviderService = {
        run: () =>
          Effect.succeed({
            sessionId: "review-session-1",
            output: reviewPassFixture(),
          }),
        resume: (prev, options) =>
          Effect.gen(function* () {
            yield* Ref.update(resumes, (n) => n + 1);
            yield* submitReviewPassViaTools(options);
            return session(prev.sessionId);
          }),
      };
      const result = yield* runReviewAttempt({
        reviewAgent,
        sandbox,
        ticketId: "T-1",
        prompt: workPrompt,
        wireMissCap: 2,
        buildAttempts: 1,
        reviewAttempts: 0,
      });
      assert.strictEqual(result.outcome, ReviewAttemptOutcome.Pass);
      assert.strictEqual(yield* Ref.get(resumes), 1);
    })
  );

  it.effect("wire-miss resumes until tool submit within cap", () =>
    Effect.gen(function* () {
      const resumes = yield* Ref.make(0);
      const reviewAgent: AgentProviderService = {
        run: () => Effect.succeed(session()),
        resume: (prev, options) =>
          Effect.gen(function* () {
            yield* Ref.update(resumes, (n) => n + 1);
            yield* submitReviewPassViaTools(options);
            return session(prev.sessionId);
          }),
      };
      const result = yield* runReviewAttempt({
        reviewAgent,
        sandbox,
        ticketId: "T-1",
        prompt: workPrompt,
        wireMissCap: 2,
        buildAttempts: 1,
        reviewAttempts: 0,
      });
      assert.strictEqual(result.outcome, ReviewAttemptOutcome.Pass);
      assert.strictEqual(yield* Ref.get(resumes), 1);
    })
  );

  it.effect("returns wireMissCapExhausted when resumes exceed cap", () =>
    Effect.gen(function* () {
      const reviewAgent: AgentProviderService = {
        run: () => Effect.succeed(session()),
        resume: (prev) => Effect.succeed(session(prev.sessionId)),
      };
      const result = yield* runReviewAttempt({
        reviewAgent,
        sandbox,
        ticketId: "T-1",
        prompt: workPrompt,
        wireMissCap: 1,
        buildAttempts: 1,
        reviewAttempts: 0,
      });
      assert.strictEqual(
        result.outcome,
        ReviewAttemptOutcome.WireMissCapExhausted
      );
      if (result.outcome === ReviewAttemptOutcome.WireMissCapExhausted) {
        assert.isTrue(result.detail.includes("1"));
        assert.strictEqual(result.sessionId, "review-session-1");
        assert.strictEqual(result.reviewAttempts, 1);
      }
    })
  );

  it.effect("last successful tool call wins", () =>
    Effect.gen(function* () {
      const reviewAgent: AgentProviderService = {
        run: (options) =>
          Effect.gen(function* () {
            yield* submitReviewPassViaTools(options, {
              verdict: ReviewVerdict.Pass,
              prTitle: "first title",
              prBody: "first body",
            });
            yield* submitReviewFailViaTools(options, "later fail wins");
            return session();
          }),
        resume: () => Effect.die("unused"),
      };
      const result = yield* runReviewAttempt({
        reviewAgent,
        sandbox,
        ticketId: "T-1",
        prompt: workPrompt,
        wireMissCap: 2,
        buildAttempts: 1,
        reviewAttempts: 0,
      });
      assert.strictEqual(result.outcome, ReviewAttemptOutcome.Fail);
      if (result.outcome === ReviewAttemptOutcome.Fail) {
        assert.strictEqual(result.failReport, "later fail wins");
      }
    })
  );

  it.effect("emits Review StepEnter/ok and WireMiss on resume path", () =>
    Effect.gen(function* () {
      const lines: string[] = [];
      const reviewAgent: AgentProviderService = {
        run: () => Effect.succeed(session()),
        resume: (prev, options) =>
          Effect.gen(function* () {
            yield* submitReviewPassViaTools(options);
            return session(prev.sessionId);
          }),
      };
      yield* runReviewAttempt({
        reviewAgent,
        sandbox,
        ticketId: "T-1",
        prompt: workPrompt,
        wireMissCap: 2,
        buildAttempts: 1,
        reviewAttempts: 0,
      }).pipe(Effect.provide(Logger.layer([captureAdwProgressLogger(lines)])));

      assert.isTrue(
        lines.some((l) => l.includes("step_enter") && l.includes("review"))
      );
      assert.isTrue(lines.some((l) => l.includes("wire_miss")));
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
