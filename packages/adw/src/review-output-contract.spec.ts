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

  it("shows pass and fail JSON examples", () => {
    const prompt = reviewOutputContractPrompt();
    assert.isTrue(prompt.includes(`"verdict": "${ReviewVerdict.Pass}"`));
    assert.isTrue(prompt.includes(`"verdict": "${ReviewVerdict.Fail}"`));
  });
});
