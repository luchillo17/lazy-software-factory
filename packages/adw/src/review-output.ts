import { Schema } from "effect";
import { ReviewVerdict } from "./enums.ts";

const NonEmpty = Schema.NonEmptyString;

/** Review pass wire: advance to Ship with PR draft fields. */
export const ReviewPassOutput = Schema.Struct({
  verdict: Schema.Literal(ReviewVerdict.Pass),
  prTitle: NonEmpty,
  prBody: NonEmpty,
});
export type ReviewPassOutput = typeof ReviewPassOutput.Type;

/** Review fail wire: resume Build with fail report. */
export const ReviewFailOutput = Schema.Struct({
  verdict: Schema.Literal(ReviewVerdict.Fail),
  failReport: NonEmpty,
});
export type ReviewFailOutput = typeof ReviewFailOutput.Type;

/** Structured Review agent output orchestration parses (ADR-0009). */
export const ReviewOutput = Schema.Union([ReviewPassOutput, ReviewFailOutput]);
export type ReviewOutput = typeof ReviewOutput.Type;
