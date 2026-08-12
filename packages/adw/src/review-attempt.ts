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
import {
  reviewOutputContractPrompt,
  schemaRepairPrompt,
} from "./review-output-contract.ts";
import { ReviewOutput, type ReviewPassOutput } from "./review-output.ts";
import { AgentRole, bootstrapRoleSkillPrompt } from "./role-skill-binding.ts";

/** Closed outcome set for one Review create + schema-resume loop. */
export const ReviewAttemptOutcome = {
  Pass: "pass",
  Fail: "fail",
  SchemaCapExhausted: "schemaCapExhausted",
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
      readonly outcome: typeof ReviewAttemptOutcome.SchemaCapExhausted;
      readonly detail: string;
      readonly sessionId: string;
      readonly reviewAttempts: number;
    };

export interface RunReviewAttemptInput {
  readonly reviewAgent: AgentProviderService;
  readonly sandbox: Sandbox;
  readonly ticketId: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly schemaResumeCap: number;
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

/**
 * One Review entry: create session, schema-resume until decode, emit Review
 * progress. Caller owns Review attempt cap routing and Build resume.
 */
export const runReviewAttempt = (
  input: RunReviewAttemptInput
): Effect.Effect<ReviewAttemptResult, AgentError> =>
  Effect.gen(function* () {
    const {
      reviewAgent,
      sandbox,
      ticketId,
      env,
      schemaResumeCap,
      buildAttempts,
    } = input;

    yield* emitAdwProgress({
      kind: AdwProgressKind.StepEnter,
      step: AdwStep.Review,
      buildAttempts,
      reviewAttempts: input.reviewAttempts,
    });

    let reviewSession = yield* reviewAgent.run({
      prompt: bootstrapRoleSkillPrompt(
        AgentRole.Review,
        [
          reviewOutputContractPrompt(),
          "",
          `Review changes for ticket ${ticketId}`,
        ].join("\n")
      ),
      sandbox,
      env,
    });
    const reviewAttempts = input.reviewAttempts + 1;
    const sessionId = reviewSession.sessionId;
    let schemaResumes = 0;

    let decoded: ReviewOutput | undefined;
    while (decoded === undefined) {
      const decodeAttempt = yield* Schema.decodeUnknownEffect(ReviewOutput)(
        reviewSession.output
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

      const raw = reviewOutputRaw(reviewSession.output);

      yield* emitAdwProgress({
        kind: AdwProgressKind.SchemaMiss,
        reviewAttempts,
        raw,
      });

      if (schemaResumes >= schemaResumeCap) {
        yield* emitAdwProgress({
          kind: AdwProgressKind.StepResult,
          step: AdwStep.Review,
          result: AdwStepResult.Fail,
          buildAttempts,
          reviewAttempts,
        });
        return {
          outcome: ReviewAttemptOutcome.SchemaCapExhausted,
          detail: `Review schema resume cap exhausted (${schemaResumeCap})`,
          sessionId,
          reviewAttempts,
        } satisfies ReviewAttemptResult;
      }

      yield* emitAdwProgress({
        kind: AdwProgressKind.StepResult,
        step: AdwStep.Review,
        result: AdwStepResult.SchemaResume,
        buildAttempts,
        reviewAttempts,
      });
      reviewSession = yield* reviewAgent.resume(reviewSession, {
        prompt: schemaRepairPrompt(decodeAttempt.message, raw),
        sandbox,
        env,
      });
      schemaResumes += 1;
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
