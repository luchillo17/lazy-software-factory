import { Schema } from "effect";
import { ReviewVerdictSchema } from "./enums.ts";

/** Structured Review agent output orchestration parses (ADR-0009). */
export const ReviewOutput = Schema.Struct({
  verdict: ReviewVerdictSchema,
  failReport: Schema.optional(Schema.String),
});
export type ReviewOutput = typeof ReviewOutput.Type;
