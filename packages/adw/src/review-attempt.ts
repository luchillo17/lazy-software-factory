/**
 * One Review entry: create session with submit tools, wire-miss resume until
 * accepted stash decode, emit Review progress (ADR-0009, ADR-0014).
 * Caller owns Review attempt cap routing and Build resume.
 */
import {
  type AgentError,
  type AgentProviderService,
  type Sandbox,
} from "@lazy-software-factory/runtime";
import { Effect, Schema } from "effect";
import {
  AdwProgressKind,
  AdwStep,
  AdwStepResult,
} from "./adw-progress-event.ts";
import { emitAdwProgress } from "./adw-progress.ts";
import { ReviewVerdict } from "./enums.ts";
import { ReviewOutput, type ReviewPassOutput } from "./review-output.ts";
import { hostSkillPackRoot } from "./host-skill-pack-root.ts";
import { AgentRole, bootstrapRoleSkillPrompt } from "./role-skill-binding.ts";
import {
  createReviewVerdictToolStash,
  makeReviewVerdictCustomTools,
  reviewOutputContractPrompt,
  wireMissRepairPrompt,
} from "./review-verdict-tools.ts";

/** Closed outcome set for one Review create + wire-miss resume loop. */
export const ReviewAttemptOutcome = {
  Pass: "pass",
  Fail: "fail",
  WireMissCapExhausted: "wireMissCapExhausted",
} as const;

export const ReviewAttemptOutcomeSchema = Schema.Enum(ReviewAttemptOutcome);
export type ReviewAttemptOutcome = typeof ReviewAttemptOutcomeSchema.Type;

export type ReviewAttemptResult =
  | {
      readonly outcome: typeof ReviewAttemptOutcome.Pass;
      readonly pass: ReviewPassOutput;
      readonly sessionId: string;
      readonly reviewAttempts: number;
    }
  | {
      readonly outcome: typeof ReviewAttemptOutcome.Fail;
      readonly failReport: string;
      readonly sessionId: string;
      readonly reviewAttempts: number;
    }
  | {
      readonly outcome: typeof ReviewAttemptOutcome.WireMissCapExhausted;
      readonly detail: string;
      readonly sessionId: string;
      readonly reviewAttempts: number;
    };

export interface RunReviewAttemptInput {
  readonly reviewAgent: AgentProviderService;
  readonly sandbox: Sandbox;
  readonly ticketId: string;
  /** Same ticket body Build got (AC / issue text) for Review judgment context. */
  readonly ticketPrompt: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Inner wire-miss resume budget (ADR-0009). */
  readonly wireMissCap: number;
  readonly buildAttempts: number;
  /** Review creates charged before this attempt. */
  readonly reviewAttempts: number;
}

const reviewOutputRaw = (output: unknown): string => {
  if (output === undefined) {
    return "undefined";
  }
  if (typeof output === "string") {
    return output;
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
};

/** Work section under Role bootstrap: contract + ticket context + submit guidance. */
export const reviewCreateWorkPrompt = (
  ticketId: string,
  ticketPrompt: string
): string =>
  [
    reviewOutputContractPrompt(),
    "",
    `Review changes for ticket ${ticketId}.`,
    "Judge the pending delta against the ticket acceptance criteria below.",
    "Inspect git status / diff if needed, then submit the verdict via submit_review_pass or submit_review_fail.",
    "",
    "## Ticket",
    "",
    ticketPrompt.trim(),
  ].join("\n");

export const runReviewAttempt = (
  input: RunReviewAttemptInput
): Effect.Effect<ReviewAttemptResult, AgentError> =>
  Effect.gen(function* () {
    const {
      reviewAgent,
      sandbox,
      ticketId,
      ticketPrompt,
      env,
      wireMissCap,
      buildAttempts,
    } = input;

    yield* emitAdwProgress({
      kind: AdwProgressKind.StepEnter,
      step: AdwStep.Review,
      buildAttempts,
      reviewAttempts: input.reviewAttempts,
    });

    const toolStash = createReviewVerdictToolStash();
    const customTools = makeReviewVerdictCustomTools(toolStash);

    let reviewSession = yield* reviewAgent.run({
      prompt: bootstrapRoleSkillPrompt(
        AgentRole.Review,
        reviewCreateWorkPrompt(ticketId, ticketPrompt)
      ),
      sandbox,
      env,
      customTools,
      workspaceDirs: [hostSkillPackRoot],
    });
    const reviewAttempts = input.reviewAttempts + 1;
    const sessionId = reviewSession.sessionId;
    let wireMissResumes = 0;

    let decoded: ReviewOutput | undefined;
    while (decoded === undefined) {
      // Tool-only wire (ADR-0014): ignore session.output prose.
      const candidate = toolStash.value;
      const decodeAttempt = yield* Schema.decodeUnknownEffect(ReviewOutput)(
        candidate
      ).pipe(
        Effect.map((value) => ({ ok: true as const, value })),
        Effect.catchTag("SchemaError", (err) =>
          Effect.succeed({
            ok: false as const,
            message: err.message,
          })
        )
      );

      if (decodeAttempt.ok) {
        decoded = decodeAttempt.value;
        break;
      }

      const raw = reviewOutputRaw(
        candidate ?? reviewSession.output ?? "no submit_review_* tool call"
      );
      const missDetail = `no successful submit_review_* tool call; ${decodeAttempt.message}`;

      yield* emitAdwProgress({
        kind: AdwProgressKind.WireMiss,
        reviewAttempts,
        raw,
      });

      if (wireMissResumes >= wireMissCap) {
        yield* emitAdwProgress({
          kind: AdwProgressKind.StepResult,
          step: AdwStep.Review,
          result: AdwStepResult.Fail,
          buildAttempts,
          reviewAttempts,
        });
        return {
          outcome: ReviewAttemptOutcome.WireMissCapExhausted,
          detail: `Review wire-miss resume cap exhausted (${wireMissCap})`,
          sessionId,
          reviewAttempts,
        } satisfies ReviewAttemptResult;
      }

      yield* emitAdwProgress({
        kind: AdwProgressKind.StepResult,
        step: AdwStep.Review,
        result: AdwStepResult.WireResume,
        buildAttempts,
        reviewAttempts,
      });
      reviewSession = yield* reviewAgent.resume(reviewSession, {
        prompt: wireMissRepairPrompt(missDetail, raw),
        sandbox,
        env,
        customTools,
        workspaceDirs: [hostSkillPackRoot],
      });
      wireMissResumes += 1;
    }

    if (decoded.verdict === ReviewVerdict.Pass) {
      yield* emitAdwProgress({
        kind: AdwProgressKind.StepResult,
        step: AdwStep.Review,
        result: AdwStepResult.Ok,
        buildAttempts,
        reviewAttempts,
      });
      return {
        outcome: ReviewAttemptOutcome.Pass,
        pass: decoded,
        sessionId,
        reviewAttempts,
      } satisfies ReviewAttemptResult;
    }

    yield* emitAdwProgress({
      kind: AdwProgressKind.StepResult,
      step: AdwStep.Review,
      result: AdwStepResult.Fail,
      buildAttempts,
      reviewAttempts,
    });

    return {
      outcome: ReviewAttemptOutcome.Fail,
      failReport: decoded.failReport ?? "Review failed without a fail report",
      sessionId,
      reviewAttempts,
    } satisfies ReviewAttemptResult;
  });
