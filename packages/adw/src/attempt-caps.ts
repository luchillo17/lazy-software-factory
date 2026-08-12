import { Context, Layer } from "effect";

/** Build↔Test loop attempt budget (ADR-0009). Default 5. */
export class AdwBuildAttemptCap extends Context.Service<
  AdwBuildAttemptCap,
  { readonly maxAttempts: number }
>()("@lazy-software-factory/adw/AdwBuildAttemptCap") {
  static readonly Default = Layer.succeed(
    AdwBuildAttemptCap,
    AdwBuildAttemptCap.of({ maxAttempts: 5 })
  );
}

/** Review attempt budget (ADR-0009). Default 3. Separate from Build. */
export class AdwReviewAttemptCap extends Context.Service<
  AdwReviewAttemptCap,
  { readonly maxAttempts: number }
>()("@lazy-software-factory/adw/AdwReviewAttemptCap") {
  static readonly Default = Layer.succeed(
    AdwReviewAttemptCap,
    AdwReviewAttemptCap.of({ maxAttempts: 3 })
  );
}

/**
 * Inner wire-miss resume budget per Review session (ADR-0009 / ADR-0014).
 * Default 3. Does not spend Review attempts; exhaust → ADW failed without Build resume.
 */
export class AdwSchemaResumeCap extends Context.Service<
  AdwSchemaResumeCap,
  { readonly maxAttempts: number }
>()("@lazy-software-factory/adw/AdwSchemaResumeCap") {
  static readonly Default = Layer.succeed(
    AdwSchemaResumeCap,
    AdwSchemaResumeCap.of({ maxAttempts: 3 })
  );
}
