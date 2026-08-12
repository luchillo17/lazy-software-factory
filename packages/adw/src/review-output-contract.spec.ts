import { assert, describe, it } from "@effect/vitest";
import { ReviewVerdict } from "./enums.ts";
import { reviewOutputContractPrompt } from "./review-output-contract.ts";

describe("reviewOutputContractPrompt", () => {
  it("states submit_review_pass and submit_review_fail tool contract", () => {
    const prompt = reviewOutputContractPrompt();
    assert.isTrue(prompt.includes("submit_review_pass"));
    assert.isTrue(prompt.includes("submit_review_fail"));
    assert.isTrue(prompt.includes("prTitle"));
    assert.isTrue(prompt.includes("prBody"));
    assert.isTrue(prompt.includes("failReport"));
    assert.isTrue(prompt.includes("Do **not** emit ReviewOutput JSON"));
  });

  it("does not require final-message ReviewOutput JSON verdict shape", () => {
    const prompt = reviewOutputContractPrompt();
    assert.isFalse(prompt.includes(`"verdict": "${ReviewVerdict.Pass}"`));
    assert.isFalse(prompt.includes(`"verdict": "${ReviewVerdict.Fail}"`));
  });

  it("points PR draft quality to /adw-review pr-draft.md", () => {
    const prompt = reviewOutputContractPrompt();
    assert.isTrue(prompt.includes("/adw-review"));
    assert.isTrue(prompt.includes("pr-draft.md"));
    assert.isTrue(prompt.includes("lead paragraph"));
  });
});
