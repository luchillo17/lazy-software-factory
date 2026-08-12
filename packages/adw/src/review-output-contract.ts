import { truncateProgressRaw } from "./adw-progress-event.ts";
import { ReviewVerdict } from "./enums.ts";
import { redactSecrets } from "./redact-secrets.ts";

/**
 * Create-time Review wire contract for orchestration (ADR-0009).
 * Shape only — PR draft quality SoT is `/adw-review` (`pr-draft.md`).
 */
export const reviewOutputContractPrompt = (): string =>
  [
    "## ReviewOutput wire contract",
    "",
    "Emit exactly one JSON object as the **last** block. Shape:",
    "",
    "```json",
    `{ "verdict": "${ReviewVerdict.Pass}", "prTitle": "<PR title>", "prBody": "<PR body markdown>" }`,
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
      "`. On pass, `prTitle` and `prBody` are required non-empty (Ship agent opens the PR with them). On fail, `failReport` is required non-empty text for Build.",
    "",
    "PR draft quality (pass): follow `/adw-review` → `pr-draft.md` (title + lead paragraph name the concrete change).",
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
