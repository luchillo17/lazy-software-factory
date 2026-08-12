import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { ReviewVerdict } from "./enums.ts";
import { ReviewOutput } from "./review-output.ts";
import { reviewPassFixture } from "./review-pass-fixture.ts";

describe("ReviewOutput", () => {
  it.effect("decodes pass with prTitle and prBody", () =>
    Effect.gen(function* () {
      const value = yield* Schema.decodeUnknownEffect(ReviewOutput)(
        reviewPassFixture({
          prTitle: "feat: x",
          prBody: "## Summary\n- y",
        })
      );
      assert.strictEqual(value.verdict, ReviewVerdict.Pass);
      if (value.verdict === ReviewVerdict.Pass) {
        assert.strictEqual(value.prTitle, "feat: x");
        assert.strictEqual(value.prBody, "## Summary\n- y");
      }
    })
  );

  it.effect("rejects pass without prTitle/prBody", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(ReviewOutput)({
        verdict: ReviewVerdict.Pass,
      }).pipe(Effect.exit);
      assert.strictEqual(result._tag, "Failure");
    })
  );

  it.effect("decodes fail with failReport", () =>
    Effect.gen(function* () {
      const value = yield* Schema.decodeUnknownEffect(ReviewOutput)({
        verdict: ReviewVerdict.Fail,
        failReport: "bug at a.ts:1",
      });
      assert.strictEqual(value.verdict, ReviewVerdict.Fail);
      if (value.verdict === ReviewVerdict.Fail) {
        assert.strictEqual(value.failReport, "bug at a.ts:1");
      }
    })
  );
});
