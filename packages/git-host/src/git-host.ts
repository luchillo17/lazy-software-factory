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

  /**
   * True when `remote` already has heads/`branch` (e.g. `git ls-remote --heads`).
   * Used by Workspace provision to fail closed before overwriting a ticket branch.
   */
  readonly remoteBranchExists: (options: {
    readonly cwd: string;
    readonly branch: string;
    readonly remote?: string;
    readonly env?: Readonly<Record<string, string>>;
  }) => Effect.Effect<boolean, GitHostError>;

  /**
   * Open PR/MR whose head is `head`, or `null` when none. URL surfaced in
   * provision failure detail when present.
   */
  readonly findOpenPullRequest: (options: {
    readonly cwd: string;
    readonly head: string;
    readonly env?: Readonly<Record<string, string>>;
  }) => Effect.Effect<{ readonly url: string } | null, GitHostError>;
}

/** Forge-swappable Git host seam (ADR-0011). */
export class GitHost extends Context.Service<GitHost, GitHostService>()(
  "@lazy-software-factory/git-host/GitHost"
) {}
