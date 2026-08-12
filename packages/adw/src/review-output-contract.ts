/**
 * Re-exports Review wire contract prompts (ADR-0014 tool-only).
 * Kept so existing imports of review-output-contract keep resolving.
 */
export {
  reviewOutputContractPrompt,
  wireMissRepairPrompt,
} from "./review-verdict-tools.ts";
