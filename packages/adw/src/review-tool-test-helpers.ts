import type { AgentRunOptions } from "@lazy-software-factory/runtime";
import { Effect } from "effect";
import type { ReviewPassOutput } from "./review-output.ts";
import { reviewPassFixture } from "./review-pass-fixture.ts";

/** Test helper: simulate Review agent calling submit_review_pass. */
export const submitReviewPassViaTools = (
  options: AgentRunOptions,
  pass: ReviewPassOutput = reviewPassFixture()
): Effect.Effect<void> =>
  Effect.promise(async () => {
    const tool = options.customTools?.["submit_review_pass"];
    if (tool === undefined) {
      throw new Error("expected submit_review_pass customTool");
    }
    await tool.execute({ prTitle: pass.prTitle, prBody: pass.prBody }, {});
  });

/** Test helper: simulate Review agent calling submit_review_fail. */
export const submitReviewFailViaTools = (
  options: AgentRunOptions,
  failReport: string
): Effect.Effect<void> =>
  Effect.promise(async () => {
    const tool = options.customTools?.["submit_review_fail"];
    if (tool === undefined) {
      throw new Error("expected submit_review_fail customTool");
    }
    await tool.execute({ failReport }, {});
  });
