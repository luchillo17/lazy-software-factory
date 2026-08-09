import { Schema } from "effect";

/** Terminal / interim outcomes for `runMinimalAdw` (ADR-0007, ADR-0011). */
export const AdwStatus = {
  Shipped: "shipped",
  Failed: "failed",
  NotImplemented: "not_implemented",
  ReadyForPr: "ready_for_pr",
} as const;

export const AdwStatusSchema = Schema.Enum(AdwStatus);
export type AdwStatus = typeof AdwStatusSchema.Type;

/** Structured Review output orchestration parses (ADR-0009). */
export const ReviewVerdict = {
  Pass: "pass",
  Fail: "fail",
} as const;

export const ReviewVerdictSchema = Schema.Enum(ReviewVerdict);
export type ReviewVerdict = typeof ReviewVerdictSchema.Type;
