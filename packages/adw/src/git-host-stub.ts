import { Effect } from "effect";
import { GitHost, type GitHostService } from "./git-host.ts";

/** Test stub: unused ops die; collision preflight reports clear by default. */
export const stubGitHost = (
  overrides: Partial<GitHostService> = {}
): GitHostService =>
  GitHost.of({
    commitWorkingTree: () => Effect.void,
    clone: () => Effect.die("unused"),
    push: () => Effect.die("unused"),
    openPullRequest: () => Effect.die("unused"),
    remoteBranchExists: () => Effect.succeed(false),
    findOpenPullRequest: () => Effect.succeed(null),
    ...overrides,
  });
