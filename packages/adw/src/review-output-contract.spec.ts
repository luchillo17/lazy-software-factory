import { assert, describe, it } from "@effect/vitest";
import { ReviewVerdict } from "./enums.ts";
import { reviewOutputContractPrompt } from "./review-output-contract.ts";

describe("reviewOutputContractPrompt", () => {
  it("states ReviewOutput wire keys and pass/fail verdicts", () => {
    const prompt = reviewOutputContractPrompt();
    assert.isTrue(prompt.includes("ReviewOutput"));
    assert.isTrue(prompt.includes('"verdict"'));
    assert.isTrue(prompt.includes(ReviewVerdict.Pass));
    assert.isTrue(prompt.includes(ReviewVerdict.Fail));
    assert.isTrue(prompt.includes("failReport"));
  });

  it("shows pass and fail JSON examples with PR draft on pass", () => {
    const prompt = reviewOutputContractPrompt();
    assert.isTrue(prompt.includes(`"verdict": "${ReviewVerdict.Pass}"`));
    assert.isTrue(prompt.includes("prTitle"));
    assert.isTrue(prompt.includes("prBody"));
    assert.isTrue(prompt.includes(`"verdict": "${ReviewVerdict.Fail}"`));
  });

  it("points PR draft quality to /adw-review pr-draft.md", () => {
    const prompt = reviewOutputContractPrompt();
    assert.isTrue(prompt.includes("/adw-review"));
    assert.isTrue(prompt.includes("pr-draft.md"));
    assert.isTrue(prompt.includes("lead paragraph"));
  });
});
