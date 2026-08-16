import {
  RuntimeErrorTag,
  type ExecResult,
  type Sandbox,
} from "@lazy-software-factory/runtime";
import { Effect, Schema } from "effect";
import {
  AdwProgressKind,
  AdwStep,
  AdwStepResult,
} from "./adw-progress-event.ts";
import { emitAdwProgress } from "./adw-progress.ts";

/** Closed outcome set for the SeamConfirm Code agent. */
export const SeamConfirmOutcome = {
  Confirm: "confirm",
  Skip: "skip",
} as const;

export const SeamConfirmOutcomeSchema = Schema.Enum(SeamConfirmOutcome);
export type SeamConfirmOutcome = typeof SeamConfirmOutcomeSchema.Type;

/** One AFK seam-confirm resume per Minimal ADW run. */
export const SEAM_CONFIRM_CAP = 1;

/**
 * Resume text when SeamConfirm accepts proposed `/tdd` seams (AFK stub until
 * HITL ADWs exist).
 */
export const seamConfirmResumePrompt = [
  "AFK SeamConfirm: proposed seams accepted.",
  "Continue /tdd red-green at those seams.",
  "Do not wait for further confirmation.",
].join(" ");

const SEAM_WORD = /\bseams?\b/;

export type SeamConfirmResult = {
  readonly outcome: SeamConfirmOutcome;
};

export interface RunSeamConfirmAgentInput {
  readonly sandbox: Sandbox;
  readonly output: unknown;
  readonly seamConfirmCount: number;
  readonly buildAttempts: number;
  readonly reviewAttempts: number;
}

const outputHaystack = (output: unknown): string => {
  if (output === undefined) {
    return "";
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

const hasSeamWaitMarker = (haystack: string): boolean =>
  SEAM_WORD.test(haystack.toLowerCase());

const execGit = (
  sandbox: Sandbox,
  args: readonly string[]
): Effect.Effect<ExecResult | void> =>
  sandbox
    .exec("git", args)
    .pipe(Effect.catchTag(RuntimeErrorTag.SandboxExecError, () => Effect.void));

const isEmptyStdout = (result: ExecResult | void): boolean =>
  result !== undefined && result.exitCode === 0 && result.stdout.trim() === "";

const diffRange = (sandbox: Sandbox): Effect.Effect<string> =>
  Effect.gen(function* () {
    const originMain = yield* execGit(sandbox, [
      "merge-base",
      "HEAD",
      "origin/main",
    ]);
    if (originMain !== undefined && originMain.exitCode === 0) {
      const sha = originMain.stdout.trim();
      if (sha !== "") {
        return sha;
      }
    }
    return "main";
  });

const pendingDeltaEmpty = (sandbox: Sandbox): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const porcelain = yield* execGit(sandbox, ["status", "--porcelain"]);
    if (!isEmptyStdout(porcelain)) {
      return false;
    }
    const range = yield* diffRange(sandbox);
    const diff = yield* execGit(sandbox, ["diff", `${range}..HEAD`]);
    return isEmptyStdout(diff);
  });

/**
 * **SeamConfirm agent** — Code agent: AFK stub for `/tdd` seam confirmation.
 * Confirm only when pending delta is empty, Build output has seam-wait
 * markers, and the per-run cap is unused. Else Skip. Git exec failure is Skip
 * (do not Confirm when delta is unknown).
 */
export const runSeamConfirmAgent = (
  input: RunSeamConfirmAgentInput
): Effect.Effect<SeamConfirmResult> =>
  Effect.gen(function* () {
    const { sandbox, output, seamConfirmCount, buildAttempts, reviewAttempts } =
      input;

    yield* emitAdwProgress({
      kind: AdwProgressKind.StepEnter,
      step: AdwStep.SeamConfirm,
      buildAttempts,
      reviewAttempts,
    });

    const skip = yield* Effect.gen(function* () {
      if (seamConfirmCount >= SEAM_CONFIRM_CAP) {
        return true;
      }
      if (!hasSeamWaitMarker(outputHaystack(output))) {
        return true;
      }
      return !(yield* pendingDeltaEmpty(sandbox));
    });

    if (skip) {
      yield* emitAdwProgress({
        kind: AdwProgressKind.StepResult,
        step: AdwStep.SeamConfirm,
        result: AdwStepResult.Ok,
        buildAttempts,
        reviewAttempts,
      });
      return {
        outcome: SeamConfirmOutcome.Skip,
      } satisfies SeamConfirmResult;
    }

    yield* emitAdwProgress({
      kind: AdwProgressKind.StepResult,
      step: AdwStep.SeamConfirm,
      result: AdwStepResult.Resume,
      buildAttempts,
      reviewAttempts,
    });
    return {
      outcome: SeamConfirmOutcome.Confirm,
    } satisfies SeamConfirmResult;
  });
