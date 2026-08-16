import { Schema } from "effect";
import { redactSecrets } from "./redact-secrets.ts";

/** Minimal ADW step names for progress events (orchestration boundaries). */
export const AdwStep = {
  Provision: "provision",
  Build: "build",
  SeamConfirm: "seam_confirm",
  Test: "test",
  Review: "review",
  Ship: "ship",
} as const;
export const AdwStepSchema = Schema.Enum(AdwStep);
export type AdwStep = typeof AdwStepSchema.Type;

export const AdwProgressKind = {
  StepEnter: "step_enter",
  StepResult: "step_result",
  WireMiss: "wire_miss",
} as const;
export const AdwProgressKindSchema = Schema.Enum(AdwProgressKind);
export type AdwProgressKind = typeof AdwProgressKindSchema.Type;

export const AdwStepResult = {
  Ok: "ok",
  Fail: "fail",
  Resume: "resume",
  WireResume: "wire_resume",
  BuildResume: "build_resume",
} as const;
export const AdwStepResultSchema = Schema.Enum(AdwStepResult);
export type AdwStepResult = typeof AdwStepResultSchema.Type;

/** Default max chars of raw Review output kept on wire_miss lines. */
export const DEFAULT_PROGRESS_RAW_MAX = 120;

export type AdwProgressEvent =
  | {
      readonly kind: typeof AdwProgressKind.StepEnter;
      readonly step: AdwStep;
      readonly buildAttempts?: number;
      readonly reviewAttempts?: number;
    }
  | {
      readonly kind: typeof AdwProgressKind.StepResult;
      readonly step: AdwStep;
      readonly result: AdwStepResult;
      readonly buildAttempts?: number;
      readonly reviewAttempts?: number;
    }
  | {
      readonly kind: typeof AdwProgressKind.WireMiss;
      readonly reviewAttempts: number;
      readonly raw: string;
    };

export const truncateProgressRaw = (
  text: string,
  maxChars: number = DEFAULT_PROGRESS_RAW_MAX
): string => {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}…`;
};

const attemptsFields = (event: {
  readonly buildAttempts?: number;
  readonly reviewAttempts?: number;
}): string => {
  const parts: string[] = [];
  if (event.buildAttempts !== undefined) {
    parts.push(`buildAttempts=${event.buildAttempts}`);
  }
  if (event.reviewAttempts !== undefined) {
    parts.push(`reviewAttempts=${event.reviewAttempts}`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
};

/** One-line operator-facing encoding of an ADW progress event. */
export const formatAdwProgressEvent = (event: AdwProgressEvent): string => {
  switch (event.kind) {
    case AdwProgressKind.StepEnter:
      return `adw kind=${event.kind} step=${event.step}${attemptsFields(event)}`;
    case AdwProgressKind.StepResult:
      return `adw kind=${event.kind} step=${event.step} result=${event.result}${attemptsFields(event)}`;
    case AdwProgressKind.WireMiss: {
      const raw = truncateProgressRaw(redactSecrets(event.raw));
      return `adw kind=${event.kind} reviewAttempts=${event.reviewAttempts} raw=${JSON.stringify(raw)}`;
    }
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
};
