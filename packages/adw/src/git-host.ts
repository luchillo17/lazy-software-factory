import { Context, Effect, Schema } from "effect";
import type { Sandbox } from "@lazy-software-factory/runtime";

export class GitHostError extends Schema.TaggedError<GitHostError>()(
  "GitHostError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export interface GitHostService {
  readonly push: (options: {
    readonly sandbox: Sandbox;
    readonly branch: string;
  }) => Effect.Effect<void, GitHostError>;
  readonly openPullRequest: (options: {
    readonly sandbox: Sandbox;
    readonly branch: string;
    readonly title: string;
    readonly body?: string;
  }) => Effect.Effect<{ readonly url: string }, GitHostError>;
}

/**
 * Forge-swappable Git host seam (ADR-0011). GitHub/`gh` adapter lands in #10;
 * ADW tests use Layer fakes here.
 */
export class GitHost extends Context.Service<GitHost, GitHostService>()(
  "@lazy-software-factory/adw/GitHost"
) {}
