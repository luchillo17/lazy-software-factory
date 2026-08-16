import {
  type AgentError,
  type AgentProviderService,
  type AgentSession,
  type Sandbox,
} from "@lazy-software-factory/runtime";
import { Effect, Schema } from "effect";
import {
  AdwProgressKind,
  AdwStep,
  AdwStepResult,
} from "./adw-progress-event.ts";
import { emitAdwProgress } from "./adw-progress.ts";
import {
  SeamConfirmOutcome,
  runSeamConfirmAgent,
  seamConfirmResumePrompt,
} from "./seam-confirm-agent.ts";
import type { AdwTestCommand } from "./test-commands.ts";
import { TestAgentOutcome, runTestAgent } from "./test-agent.ts";

/** Closed outcome set for one Build↔Test green chase. */
export const BuildTestOutcome = {
  Green: "green",
  CapExhausted: "capExhausted",
  ExecFail: "execFail",
} as const;

export const BuildTestOutcomeSchema = Schema.Enum(BuildTestOutcome);
export type BuildTestOutcome = typeof BuildTestOutcomeSchema.Type;

export type BuildTestResult =
  | {
      readonly outcome: typeof BuildTestOutcome.Green;
      readonly buildSession: AgentSession;
      readonly buildAttempts: number;
      readonly seamConfirmCount: number;
    }
  | {
      readonly outcome: typeof BuildTestOutcome.CapExhausted;
      readonly detail: string;
      readonly buildSession: AgentSession;
      readonly buildAttempts: number;
      readonly seamConfirmCount: number;
    }
  | {
      readonly outcome: typeof BuildTestOutcome.ExecFail;
      readonly detail: string;
      readonly buildSession: AgentSession;
      readonly buildAttempts: number;
      readonly seamConfirmCount: number;
    };

export interface RunBuildTestLoopInput {
  readonly buildAgent: AgentProviderService;
  readonly sandbox: Sandbox;
  readonly env?: Readonly<Record<string, string>>;
  readonly commands: ReadonlyArray<AdwTestCommand>;
  readonly buildSession: AgentSession;
  readonly buildAttempts: number;
  readonly reviewAttempts: number;
  readonly buildAttemptCap: number;
  readonly seamConfirmCount: number;
}

/**
 * Build↔SeamConfirm↔Test loop: SeamConfirm (AFK `/tdd` seam stub) then Test
 * until green, or Build-attempt cap / exec fail. Owns BuildResume after red
 * Test. SeamConfirm resume does not spend a Build attempt. Caller owns
 * Review→Build resume (no Build attempt spend — ADR-0009).
 */
export const runBuildTestLoop = (
  input: RunBuildTestLoopInput
): Effect.Effect<BuildTestResult, AgentError> =>
  Effect.gen(function* () {
    let buildSession = input.buildSession;
    let buildAttempts = input.buildAttempts;
    let seamConfirmCount = input.seamConfirmCount;
    const {
      buildAgent,
      sandbox,
      env,
      commands,
      reviewAttempts,
      buildAttemptCap,
    } = input;

    while (true) {
      const seam = yield* runSeamConfirmAgent({
        sandbox,
        output: buildSession.output,
        seamConfirmCount,
        buildAttempts,
        reviewAttempts,
      });
      if (seam.outcome === SeamConfirmOutcome.Confirm) {
        seamConfirmCount += 1;
        buildSession = yield* buildAgent.resume(buildSession, {
          prompt: seamConfirmResumePrompt,
          sandbox,
          env,
        });
        continue;
      }

      const testResult = yield* runTestAgent({
        sandbox,
        commands,
        buildAttempts,
        reviewAttempts,
      });

      if (testResult.outcome === TestAgentOutcome.ExecFail) {
        return {
          outcome: BuildTestOutcome.ExecFail,
          detail: testResult.detail,
          buildSession,
          buildAttempts,
          seamConfirmCount,
        } satisfies BuildTestResult;
      }

      if (testResult.outcome === TestAgentOutcome.Green) {
        return {
          outcome: BuildTestOutcome.Green,
          buildSession,
          buildAttempts,
          seamConfirmCount,
        } satisfies BuildTestResult;
      }

      if (buildAttempts >= buildAttemptCap) {
        return {
          outcome: BuildTestOutcome.CapExhausted,
          detail: testResult.detail,
          buildSession,
          buildAttempts,
          seamConfirmCount,
        } satisfies BuildTestResult;
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
        env,
      });
      buildAttempts += 1;
    }
  });
