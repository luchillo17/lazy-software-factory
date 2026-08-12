import { Schema } from "effect";

/**
 * Schema-guaranteed input for the **Ship agent** (Code agent).
 * Built by orchestration from a decoded Review **pass** (`prTitle`/`prBody`)
 * plus sandbox/ticket fields.
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
