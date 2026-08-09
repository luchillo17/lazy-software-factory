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
