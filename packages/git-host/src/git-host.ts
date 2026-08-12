import { Context, Effect, Schema } from "effect";

export class GitHostError extends Schema.TaggedError<GitHostError>()(
  "GitHostError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export interface GitHostService {
  readonly clone: (options: {
    readonly repoUrl: string;
    readonly destination: string;
    readonly env?: Readonly<Record<string, string>>;
  }) => Effect.Effect<void, GitHostError>;

  /**
   * Ship helper: if the worktree at `cwd` is dirty, stage and commit with
   * `message`. Clean tree is a no-op success.
   */
  readonly commitWorkingTree: (options: {
    readonly cwd: string;
    readonly message: string;
    readonly env?: Readonly<Record<string, string>>;
  }) => Effect.Effect<void, GitHostError>;

  readonly push: (options: {
    readonly cwd: string;
    readonly branch: string;
    readonly env?: Readonly<Record<string, string>>;
  }) => Effect.Effect<void, GitHostError>;

  readonly openPullRequest: (options: {
    readonly cwd: string;
    readonly branch: string;
    readonly title: string;
    readonly body?: string;
    readonly base?: string;
    readonly env?: Readonly<Record<string, string>>;
  }) => Effect.Effect<{ readonly url: string }, GitHostError>;
}

/** Forge-swappable Git host seam (ADR-0011). */
export class GitHost extends Context.Service<GitHost, GitHostService>()(
  "@lazy-software-factory/git-host/GitHost"
) {}
