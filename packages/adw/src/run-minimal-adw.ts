import {
  BuildAgentProvider,
  ReviewAgentProvider,
  SandboxProvider,
  type AgentSession,
} from "@lazy-software-factory/runtime";
import { Effect, Schema } from "effect";
import {
  AdwProgressKind,
  AdwStep,
  AdwStepResult,
} from "./adw-progress-event.ts";
import { emitAdwProgress } from "./adw-progress.ts";
import {
  AdwBuildAttemptCap,
  AdwReviewAttemptCap,
  AdwSchemaResumeCap,
} from "./attempt-caps.ts";
import { AdwStatus, AdwStatusSchema } from "./enums.ts";
import { GitHost } from "./git-host.ts";
import { ReviewAttemptOutcome, runReviewAttempt } from "./review-attempt.ts";
import type { ReviewPassOutput } from "./review-output.ts";
import { runShipAgent } from "./ship-agent.ts";
import { ShipInput } from "./ship-input.ts";
import { AdwTestCommands } from "./test-commands.ts";
import { TestAgentOutcome, runTestAgent } from "./test-agent.ts";
import {
  AgentRole,
  bootstrapRoleSkillPrompt,
  skillPackRootExists,
  DEFAULT_SKILL_PACK_ROOT,
} from "./role-skill-binding.ts";
import { ticketBranch } from "./ticket-branch.ts";
import { WorkspaceProvision } from "./workspace-provision.ts";

/**
 * Minimal ADW (ADR-0007): provision → Build ↔ Test → Review → Ship agent.
 *
 * Build↔Test and Review have separate attempt caps (ADR-0009). Review fail
 * resumes the original Build session without spending a Build attempt.
 * Ship is a Code agent with schema `ShipInput` from Review pass.
 */
export interface MinimalAdwInput {
  readonly ticketId: string;
  readonly prompt: string;
  /** Required when sandbox has no `.git` (clone-when-empty). */
  readonly repoUrl?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface MinimalAdwResult {
  readonly ticketId: string;
  readonly status: typeof AdwStatusSchema.Type;
  readonly detail?: string;
  readonly sandboxId?: string;
  readonly buildSessionId?: string;
  readonly reviewSessionId?: string;
  readonly prUrl?: string;
}

export type MinimalAdwServices =
  | SandboxProvider
  | BuildAgentProvider
  | ReviewAgentProvider
  | GitHost
  | AdwTestCommands
  | WorkspaceProvision
  | AdwBuildAttemptCap
  | AdwReviewAttemptCap
  | AdwSchemaResumeCap;

export const runMinimalAdw = (
  input: MinimalAdwInput
): Effect.Effect<MinimalAdwResult, never, MinimalAdwServices> =>
  Effect.scoped(
    Effect.gen(function* () {
      const sandboxes = yield* SandboxProvider;
      const buildAgent = yield* BuildAgentProvider;
      const reviewAgent = yield* ReviewAgentProvider;
      const testCommands = yield* AdwTestCommands;
      const provisioner = yield* WorkspaceProvision;
      const { maxAttempts: buildAttemptCap } = yield* AdwBuildAttemptCap;
      const { maxAttempts: reviewAttemptCap } = yield* AdwReviewAttemptCap;
      const { maxAttempts: schemaResumeCap } = yield* AdwSchemaResumeCap;

      const sandbox = yield* sandboxes.create({
        cwd: process.cwd(),
        env: input.env,
      });

      yield* emitAdwProgress({
        kind: AdwProgressKind.StepEnter,
        step: AdwStep.Provision,
      });
      yield* provisioner
        .provision({
          sandbox,
          ticketId: input.ticketId,
          repoUrl: input.repoUrl,
          env: input.env,
        })
        .pipe(
          Effect.tapError(() =>
            emitAdwProgress({
              kind: AdwProgressKind.StepResult,
              step: AdwStep.Provision,
              result: AdwStepResult.Fail,
            })
          )
        );
      yield* emitAdwProgress({
        kind: AdwProgressKind.StepResult,
        step: AdwStep.Provision,
        result: AdwStepResult.Ok,
      });

      if (!skillPackRootExists(sandbox.cwd)) {
        return {
          ticketId: input.ticketId,
          status: AdwStatus.Failed,
          detail: `Skill pack root missing: ${DEFAULT_SKILL_PACK_ROOT} under ${sandbox.cwd}`,
          sandboxId: sandbox.id,
        } satisfies MinimalAdwResult;
      }

      yield* emitAdwProgress({
        kind: AdwProgressKind.StepEnter,
        step: AdwStep.Build,
        buildAttempts: 0,
        reviewAttempts: 0,
      });
      let buildSession: AgentSession = yield* buildAgent.run({
        prompt: bootstrapRoleSkillPrompt(AgentRole.Build, input.prompt),
        sandbox,
        env: input.env,
      });
      let buildAttempts = 1;
      let reviewAttempts = 0;
      let reviewSessionId: string | undefined;
      let passReview: ReviewPassOutput | undefined;
      yield* emitAdwProgress({
        kind: AdwProgressKind.StepResult,
        step: AdwStep.Build,
        result: AdwStepResult.Ok,
        buildAttempts,
        reviewAttempts,
      });

      adw: while (true) {
        buildTest: while (true) {
          const testResult = yield* runTestAgent({
            sandbox,
            commands: testCommands.commands,
            buildAttempts,
            reviewAttempts,
          });

          if (testResult.outcome === TestAgentOutcome.ExecFail) {
            return {
              ticketId: input.ticketId,
              status: AdwStatus.Failed,
              detail: testResult.detail,
              sandboxId: sandbox.id,
              buildSessionId: buildSession.sessionId,
              reviewSessionId,
            } satisfies MinimalAdwResult;
          }

          if (testResult.outcome === TestAgentOutcome.Green) {
            break buildTest;
          }

          if (buildAttempts >= buildAttemptCap) {
            return {
              ticketId: input.ticketId,
              status: AdwStatus.Failed,
              detail: testResult.detail,
              sandboxId: sandbox.id,
              buildSessionId: buildSession.sessionId,
              reviewSessionId,
            } satisfies MinimalAdwResult;
          }

          yield* emitAdwProgress({
            kind: AdwProgressKind.StepResult,
            step: AdwStep.Build,
            result: AdwStepResult.BuildResume,
            buildAttempts,
            reviewAttempts,
          });
          buildSession = yield* buildAgent.resume(buildSession, {
            prompt: testResult.detail,
            sandbox,
            env: input.env,
          });
          buildAttempts += 1;
        }

        const reviewResult = yield* runReviewAttempt({
          reviewAgent,
          sandbox,
          ticketId: input.ticketId,
          env: input.env,
          schemaResumeCap,
          buildAttempts,
          reviewAttempts,
        });
        reviewSessionId = reviewResult.sessionId;
        reviewAttempts = reviewResult.reviewAttempts;

        if (reviewResult.outcome === ReviewAttemptOutcome.SchemaCapExhausted) {
          return {
            ticketId: input.ticketId,
            status: AdwStatus.Failed,
            detail: reviewResult.detail,
            sandboxId: sandbox.id,
            buildSessionId: buildSession.sessionId,
            reviewSessionId,
          } satisfies MinimalAdwResult;
        }

        if (reviewResult.outcome === ReviewAttemptOutcome.Pass) {
          passReview = reviewResult.pass;
          break adw;
        }

        if (reviewAttempts >= reviewAttemptCap) {
          return {
            ticketId: input.ticketId,
            status: AdwStatus.Failed,
            detail: reviewResult.failReport,
            sandboxId: sandbox.id,
            buildSessionId: buildSession.sessionId,
            reviewSessionId,
          } satisfies MinimalAdwResult;
        }

        // Review→Build: same Build session; does NOT spend a Build attempt.
        yield* emitAdwProgress({
          kind: AdwProgressKind.StepResult,
          step: AdwStep.Build,
          result: AdwStepResult.BuildResume,
          buildAttempts,
          reviewAttempts,
        });
        buildSession = yield* buildAgent.resume(buildSession, {
          prompt: reviewResult.failReport,
          sandbox,
          env: input.env,
        });
      }

      if (passReview === undefined) {
        return {
          ticketId: input.ticketId,
          status: AdwStatus.Failed,
          detail: "Review pass missing after loop exit",
          sandboxId: sandbox.id,
          buildSessionId: buildSession.sessionId,
          reviewSessionId,
        } satisfies MinimalAdwResult;
      }

      const branch = ticketBranch(input.ticketId);

      const shipInputResult = yield* Schema.decodeUnknownEffect(ShipInput)({
        ticketId: input.ticketId,
        cwd: sandbox.cwd,
        branch,
        prTitle: passReview.prTitle,
        prBody: passReview.prBody,
        env: input.env,
      }).pipe(
        Effect.map((value) => ({ ok: true as const, value })),
        Effect.catchTag("SchemaError", (err) =>
          Effect.succeed({ ok: false as const, message: err.message })
        )
      );

      if (!shipInputResult.ok) {
        return {
          ticketId: input.ticketId,
          status: AdwStatus.ReadyForPr,
          detail: `ShipInput decode failed: ${shipInputResult.message}`,
          sandboxId: sandbox.id,
          buildSessionId: buildSession.sessionId,
          reviewSessionId,
        } satisfies MinimalAdwResult;
      }

      yield* emitAdwProgress({
        kind: AdwProgressKind.StepEnter,
        step: AdwStep.Ship,
        buildAttempts,
        reviewAttempts,
      });

      const shipResult = yield* runShipAgent(shipInputResult.value);

      if (shipResult.status === AdwStatus.ReadyForPr) {
        yield* emitAdwProgress({
          kind: AdwProgressKind.StepResult,
          step: AdwStep.Ship,
          result: AdwStepResult.Fail,
          buildAttempts,
          reviewAttempts,
        });
        return {
          ticketId: input.ticketId,
          status: AdwStatus.ReadyForPr,
          detail: shipResult.detail,
          sandboxId: sandbox.id,
          buildSessionId: buildSession.sessionId,
          reviewSessionId,
        } satisfies MinimalAdwResult;
      }

      yield* emitAdwProgress({
        kind: AdwProgressKind.StepResult,
        step: AdwStep.Ship,
        result: AdwStepResult.Ok,
        buildAttempts,
        reviewAttempts,
      });
      return {
        ticketId: input.ticketId,
        status: AdwStatus.Shipped,
        sandboxId: sandbox.id,
        buildSessionId: buildSession.sessionId,
        reviewSessionId,
        prUrl: shipResult.prUrl,
      } satisfies MinimalAdwResult;
    }).pipe(
      Effect.catch((err) =>
        Effect.succeed({
          ticketId: input.ticketId,
          status: AdwStatus.Failed,
          detail: err instanceof Error ? err.message : String(err),
        } satisfies MinimalAdwResult)
      )
    )
  );
