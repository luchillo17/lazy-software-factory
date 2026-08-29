import { RuntimeErrorTag } from "@lazy-software-factory/runtime/errors";
import type {
  ExecResult,
  Sandbox,
} from "@lazy-software-factory/runtime/sandbox";
import { Effect, Schema } from "effect";
import {
  AdwProgressKind,
  AdwStep,
  AdwStepResult,
} from "./adw-progress-event.ts";
import { emitAdwProgress } from "./adw-progress.ts";
import type { AdwTestCommand } from "./test-commands.ts";

/** Closed outcome set for the Test Code agent. */
export const TestAgentOutcome = {
  Green: "green",
  Red: "red",
  ExecFail: "execFail",
} as const;

export const TestAgentOutcomeSchema = Schema.Enum(TestAgentOutcome);
export type TestAgentOutcome = typeof TestAgentOutcomeSchema.Type;

export type TestAgentResult =
  | { readonly outcome: typeof TestAgentOutcome.Green }
  | {
      readonly outcome: typeof TestAgentOutcome.Red;
      readonly detail: string;
    }
  | {
      readonly outcome: typeof TestAgentOutcome.ExecFail;
      readonly detail: string;
    };

export interface RunTestAgentInput {
  readonly sandbox: Sandbox;
  readonly commands: ReadonlyArray<AdwTestCommand>;
  readonly buildAttempts: number;
  readonly reviewAttempts: number;
}

/** Local Test-exec branch tags (not Runtime `_tag` / not ADW status). */
const TestExecBranch = {
  Ok: "ok",
  ExecError: "execError",
} as const;

const TestExecBranchSchema = Schema.Enum(TestExecBranch);
type TestExecBranch = typeof TestExecBranchSchema.Type;

const formatStep = (step: AdwTestCommand) =>
  [step.command, ...(step.args ?? [])].join(" ");

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

/**
 * **Test agent** — Code agent: run check gates in the sandbox.
 * Emits Test StepEnter / StepResult progress; caller owns Build resume + caps.
 */
export const runTestAgent = (
  input: RunTestAgentInput
): Effect.Effect<TestAgentResult> =>
  Effect.gen(function* () {
    const { sandbox, commands, buildAttempts, reviewAttempts } = input;

    yield* emitAdwProgress({
      kind: AdwProgressKind.StepEnter,
      step: AdwStep.Test,
      buildAttempts,
      reviewAttempts,
    });

    const stepResults = yield* Effect.all(
      commands.map((step) =>
        sandbox.exec({ command: step.command, argv: step.args ?? [] }).pipe(
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
        outcome: TestAgentOutcome.ExecFail,
        detail: `Test agent exec error: ${execErrors
          .map((e) => `${formatStep(e.step)}: ${e.message}`)
          .join("; ")}`,
      } satisfies TestAgentResult;
    }

    const failures = stepResults.flatMap((r) =>
      r._tag === TestExecBranch.Ok && r.gate.exitCode !== 0
        ? [{ step: r.step, gate: r.gate }]
        : []
    );

    if (failures.length > 0) {
      yield* emitAdwProgress({
        kind: AdwProgressKind.StepResult,
        step: AdwStep.Test,
        result: AdwStepResult.Fail,
        buildAttempts,
        reviewAttempts,
      });
      return {
        outcome: TestAgentOutcome.Red,
        detail: combinedGateDetail(failures),
      } satisfies TestAgentResult;
    }

    yield* emitAdwProgress({
      kind: AdwProgressKind.StepResult,
      step: AdwStep.Test,
      result: AdwStepResult.Ok,
      buildAttempts,
      reviewAttempts,
    });
    return { outcome: TestAgentOutcome.Green } satisfies TestAgentResult;
  });
