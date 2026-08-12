import {
  BuildAgentProvider,
  ReviewAgentProvider,
  RuntimeErrorTag,
  SandboxProvider,
  type AgentSession,
  type ExecResult,
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
import { AdwStatus, AdwStatusSchema, ReviewVerdict } from "./enums.ts";
import { GitHost } from "./git-host.ts";
import {
  reviewOutputContractPrompt,
  schemaRepairPrompt,
} from "./review-output-contract.ts";
import { ReviewOutput } from "./review-output.ts";
import { runShipAgent } from "./ship-agent.ts";
import { ShipInput } from "./ship-input.ts";
import { AdwTestCommands, type AdwTestCommand } from "./test-commands.ts";
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
 * Ship is a Code agent with schema {@link ShipInput}.
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

/** Local Test-exec branch tags (not Runtime `_tag` / not ADW status). */
const TestExecBranch = {
  Ok: "ok",
  ExecError: "execError",
} as const;

const formatStep = (step: AdwTestCommand) =>
  [step.command, ...(step.args ?? [])].join(" ");

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

const gateDetail = (step: AdwTestCommand, gate: ExecResult) => {
  const parts = [
    `### ${formatStep(step)} (exit ${gate.exitCode})`,
    gate.stdout ? `stdout:\n${gate.stdout}` : undefined,
    gate.stderr ? `stderr:\n${gate.stderr}` : undefined,
  ].filter((p): p is string => p !== undefined);
  return parts.join("\n");
};

const combinedGateDetail = (
  failures: ReadonlyArray<{
    readonly step: AdwTestCommand;
    readonly gate: ExecResult;
  }>
) => {
  const body = failures
    .map(({ step, gate }) => gateDetail(step, gate))
    .join("\n\n");
  return `Test agent failed (${failures.length} check gate(s) red)\n\n${body}`;
};

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
      yield* emitAdwProgress({
        kind: AdwProgressKind.StepResult,
        step: AdwStep.Build,
        result: AdwStepResult.Ok,
        buildAttempts,
        reviewAttempts,
      });

      adw: while (true) {
        buildTest: while (true) {
          let lastGateDetail = "Test agent failed";
          let allGreen = true;

          yield* emitAdwProgress({
            kind: AdwProgressKind.StepEnter,
            step: AdwStep.Test,
            buildAttempts,
            reviewAttempts,
          });

          const stepResults = yield* Effect.all(
            testCommands.commands.map((step) =>
              sandbox.exec(step.command, step.args ?? []).pipe(
                Effect.map((gate) => ({
                  _tag: TestExecBranch.Ok,
                  step,
                  gate,
                })),
                Effect.catchTag(RuntimeErrorTag.SandboxExecError, (err) =>
                  Effect.succeed({
                    _tag: TestExecBranch.ExecError,
                    step,
                    message: err.message,
                  })
                )
              )
            ),
            { concurrency: "unbounded" }
          );

          const execErrors = stepResults.filter(
            (r) => r._tag === TestExecBranch.ExecError
          );
          if (execErrors.length > 0) {
            yield* emitAdwProgress({
              kind: AdwProgressKind.StepResult,
              step: AdwStep.Test,
              result: AdwStepResult.Fail,
              buildAttempts,
              reviewAttempts,
            });
            return {
              ticketId: input.ticketId,
              status: AdwStatus.Failed,
              detail: `Test agent exec error: ${execErrors
                .map((e) => `${formatStep(e.step)}: ${e.message}`)
                .join("; ")}`,
              sandboxId: sandbox.id,
              buildSessionId: buildSession.sessionId,
              reviewSessionId,
            } satisfies MinimalAdwResult;
          }

          const failures = stepResults.flatMap((r) =>
            r._tag === TestExecBranch.Ok && r.gate.exitCode !== 0
              ? [{ step: r.step, gate: r.gate }]
              : []
          );

          if (failures.length > 0) {
            allGreen = false;
            lastGateDetail = combinedGateDetail(failures);
          }

          if (allGreen) {
            yield* emitAdwProgress({
              kind: AdwProgressKind.StepResult,
              step: AdwStep.Test,
              result: AdwStepResult.Ok,
              buildAttempts,
              reviewAttempts,
            });
            break buildTest;
          }

          yield* emitAdwProgress({
            kind: AdwProgressKind.StepResult,
            step: AdwStep.Test,
            result: AdwStepResult.Fail,
            buildAttempts,
            reviewAttempts,
          });

          if (buildAttempts >= buildAttemptCap) {
            return {
              ticketId: input.ticketId,
              status: AdwStatus.Failed,
              detail: lastGateDetail,
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
            prompt: lastGateDetail,
            sandbox,
            env: input.env,
          });
          buildAttempts += 1;
        }

        yield* emitAdwProgress({
          kind: AdwProgressKind.StepEnter,
          step: AdwStep.Review,
          buildAttempts,
          reviewAttempts,
        });
        let reviewSession = yield* reviewAgent.run({
          prompt: bootstrapRoleSkillPrompt(
            AgentRole.Review,
            [
              reviewOutputContractPrompt(),
              "",
              `Review changes for ticket ${input.ticketId}`,
            ].join("\n")
          ),
          sandbox,
          env: input.env,
        });
        reviewSessionId = reviewSession.sessionId;
        reviewAttempts += 1;
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
              ticketId: input.ticketId,
              status: AdwStatus.Failed,
              detail: `Review schema resume cap exhausted (${schemaResumeCap})`,
              sandboxId: sandbox.id,
              buildSessionId: buildSession.sessionId,
              reviewSessionId,
            } satisfies MinimalAdwResult;
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
            env: input.env,
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
          break adw;
        }

        yield* emitAdwProgress({
          kind: AdwProgressKind.StepResult,
          step: AdwStep.Review,
          result: AdwStepResult.Fail,
          buildAttempts,
          reviewAttempts,
        });

        const failReport =
          decoded.failReport ?? "Review failed without a fail report";

        if (reviewAttempts >= reviewAttemptCap) {
          return {
            ticketId: input.ticketId,
            status: AdwStatus.Failed,
            detail: failReport,
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
          prompt: failReport,
          sandbox,
          env: input.env,
        });
      }

      const branch = ticketBranch(input.ticketId);

      const shipInputResult = yield* Schema.decodeUnknownEffect(ShipInput)({
        ticketId: input.ticketId,
        cwd: sandbox.cwd,
        branch,
        prTitle: `ADW: ${input.ticketId}`,
        prBody: `Automated Minimal ADW ship for ticket ${input.ticketId}.`,
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
