import { Schema } from "effect";

/**
 * Schema-guaranteed input for the **Ship agent** (Code agent).
 * Orchestration builds this after Review pass (title/body may be placeholders
 * until Review pass owns the PR draft).
 */
export const ShipInput = Schema.Struct({
  ticketId: Schema.NonEmptyString,
  cwd: Schema.NonEmptyString,
  branch: Schema.NonEmptyString,
  prTitle: Schema.NonEmptyString,
  prBody: Schema.NonEmptyString,
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type ShipInput = typeof ShipInput.Type;
