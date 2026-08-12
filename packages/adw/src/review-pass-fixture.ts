import { ReviewVerdict } from "./enums.ts";
import type { ReviewPassOutput } from "./review-output.ts";

/** Deterministic Review pass fixture for Minimal ADW specs. */
export const reviewPassFixture = (
  overrides?: Partial<ReviewPassOutput>
): ReviewPassOutput => ({
  verdict: ReviewVerdict.Pass,
  prTitle: overrides?.prTitle ?? "feat: adw ticket",
  prBody:
    overrides?.prBody ??
    "## Summary\n- Ship Review draft\n\n## Test plan\n- [x] unit",
});
