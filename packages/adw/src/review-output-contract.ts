import { truncateProgressRaw } from "./adw-progress-event.ts";
import { ReviewVerdict } from "./enums.ts";
import { redactSecrets } from "./redact-secrets.ts";

/**
 * Create-time Review wire contract for orchestration (ADR-0009).
 * Not a Skill — composed into the Review agent create prompt.
 */
export const reviewOutputContractPrompt = (): string =>
  [
    "## ReviewOutput wire contract",
    "",
    "Emit exactly one JSON object as the **last** block. Shape:",
    "",
    "```json",
    `{ "verdict": "${ReviewVerdict.Pass}" }`,
    "```",
    "",
    "or",
    "",
    "```json",
    `{ "verdict": "${ReviewVerdict.Fail}", "failReport": "<findings: location, severity, problem, fix hint>" }`,
    "```",
    "",
    "`verdict` must be `" +
      ReviewVerdict.Pass +
      "` or `" +
      ReviewVerdict.Fail +
      "`. On fail, `failReport` is required non-empty text for Build.",
  ].join("\n");

/** Resume prompt after ReviewOutput schema miss (same Review session). */
export const schemaRepairPrompt = (
  decodeError: string,
  priorRaw: string
): string =>
  [
    "Your previous output failed ReviewOutput schema decode.",
    "",
    "Decode error:",
    decodeError,
    "",
    reviewOutputContractPrompt(),
    "",
    "Prior output (redacted/truncated):",
    truncateProgressRaw(redactSecrets(priorRaw), 500),
    "",
    "Emit exactly one valid ReviewOutput JSON object as the last block.",
  ].join("\n");
