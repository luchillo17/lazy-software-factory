/**
 * Review verdict via Cursor `local.customTools` (ADR-0014).
 * Effect Schema hard-decode in `execute`; JSON Schema `inputSchema` soft guide.
 * Last successful submit wins (stash overwrite).
 */
import type { AgentCustomTool } from "@lazy-software-factory/runtime/agent-provider";
import { Effect, Schema } from "effect";
import { truncateProgressRaw } from "./adw-progress-event.ts";
import { ReviewVerdict } from "./enums.ts";
import { redactSecrets } from "./redact-secrets.ts";
import {
  ReviewFailOutput,
  ReviewPassOutput,
  type ReviewOutput,
} from "./review-output.ts";

/** Mutable stash orchestration reads after `run.wait()` (last successful wins). */
export interface ReviewVerdictToolStash {
  value: ReviewOutput | undefined;
  events: string[];
}

export const createReviewVerdictToolStash = (): ReviewVerdictToolStash => ({
  value: undefined,
  events: [],
});

const toolError = (message: string) => ({
  isError: true as const,
  content: [{ type: "text" as const, text: message }],
});

const decodePassArgs = (args: Record<string, unknown>) =>
  Schema.decodeUnknownEffect(ReviewPassOutput)({
    verdict: ReviewVerdict.Pass,
    prTitle: args["prTitle"],
    prBody: args["prBody"],
  }).pipe(
    Effect.map((value) => ({ ok: true as const, value })),
    Effect.catchTag("SchemaError", (err) =>
      Effect.succeed({ ok: false as const, message: err.message })
    )
  );

const decodeFailArgs = (args: Record<string, unknown>) =>
  Schema.decodeUnknownEffect(ReviewFailOutput)({
    verdict: ReviewVerdict.Fail,
    failReport: args["failReport"],
  }).pipe(
    Effect.map((value) => ({ ok: true as const, value })),
    Effect.catchTag("SchemaError", (err) =>
      Effect.succeed({ ok: false as const, message: err.message })
    )
  );

/** Soft JSON Schema mirrors of pass/fail Effect structs (not the hard SoT). */
const passInputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    prTitle: {
      type: "string",
      minLength: 1,
      description: "PR title for Ship",
    },
    prBody: {
      type: "string",
      minLength: 1,
      description: "PR body markdown for Ship",
    },
  },
  required: ["prTitle", "prBody"],
  additionalProperties: false,
};

const failInputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    failReport: {
      type: "string",
      minLength: 1,
      description: "Bugbot-shaped findings for Build resume",
    },
  },
  required: ["failReport"],
  additionalProperties: false,
};

/**
 * Two tools beat one `oneOf` union.
 * Successful execute overwrites stash (last-wins).
 */
export const makeReviewVerdictCustomTools = (
  stash: ReviewVerdictToolStash
): Record<string, AgentCustomTool> => ({
  submit_review_pass: {
    description:
      "Submit a Review PASS verdict with non-empty prTitle and prBody for Ship. Call exactly once when the change is acceptable.",
    inputSchema: passInputSchema,
    execute: async (args) => {
      const decoded = await Effect.runPromise(decodePassArgs(args));
      if (!decoded.ok) {
        stash.events.push(`submit_review_pass ERROR ${decoded.message}`);
        return toolError(
          `ReviewPassOutput decode failed: ${decoded.message}. Fix args and call submit_review_pass again.`
        );
      }
      stash.value = decoded.value;
      stash.events.push("submit_review_pass OK");
      return {
        content: [{ type: "text" as const, text: "Review pass accepted." }],
        structuredContent: {
          verdict: decoded.value.verdict,
          prTitle: decoded.value.prTitle,
          prBody: decoded.value.prBody,
        },
      };
    },
  },
  submit_review_fail: {
    description:
      "Submit a Review FAIL verdict with a non-empty failReport for Build. Call exactly once when findings block Ship.",
    inputSchema: failInputSchema,
    execute: async (args) => {
      const decoded = await Effect.runPromise(decodeFailArgs(args));
      if (!decoded.ok) {
        stash.events.push(`submit_review_fail ERROR ${decoded.message}`);
        return toolError(
          `ReviewFailOutput decode failed: ${decoded.message}. Fix args and call submit_review_fail again.`
        );
      }
      stash.value = decoded.value;
      stash.events.push("submit_review_fail OK");
      return {
        content: [{ type: "text" as const, text: "Review fail accepted." }],
        structuredContent: {
          verdict: decoded.value.verdict,
          failReport: decoded.value.failReport,
        },
      };
    },
  },
});

/** Create-time Review wire contract: submit tools only (ADR-0014). */
export const reviewOutputContractPrompt = (): string =>
  [
    "## Review verdict tools",
    "",
    "Do **not** emit ReviewOutput JSON as your final message.",
    "End the review by calling exactly one tool:",
    "",
    "- `submit_review_pass` with `{ prTitle, prBody }` (both non-empty) when the change is good enough to Ship.",
    "- `submit_review_fail` with `{ failReport }` (non-empty Bugbot-shaped findings) when Build must fix.",
    "",
    "If the tool returns an error, fix the arguments and call again in this same session.",
    "PR draft quality on pass: follow `/adw-review` → `pr-draft.md` (title + lead paragraph name the concrete change).",
  ].join("\n");

/** Resume prompt after wire miss (no accepted submit tool at harvest). */
export const wireMissRepairPrompt = (
  detail: string,
  priorRaw: string
): string =>
  [
    "Your previous Review run did not produce an accepted tool verdict (wire miss).",
    "",
    detail,
    "",
    reviewOutputContractPrompt(),
    "",
    "Prior session output (redacted/truncated):",
    truncateProgressRaw(redactSecrets(priorRaw), 500),
    "",
    "Call submit_review_pass or submit_review_fail with valid arguments.",
  ].join("\n");
