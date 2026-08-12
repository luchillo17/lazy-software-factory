import { Effect, Exit } from "effect";
import { AdwStatus } from "./enums.ts";
import { GitHost } from "./git-host.ts";
import type { ShipInput } from "./ship-input.ts";

/** Outcome of the Ship Code agent (ADR-0011). */
export type ShipAgentResult =
  | {
      readonly status: typeof AdwStatus.Shipped;
      readonly prUrl: string;
    }
  | {
      readonly status: typeof AdwStatus.ReadyForPr;
      readonly detail: string;
    };

/**
 * Commitlint-safe message for Ship flush of pending worktree.
 * Type must be conventional (`chore`); bare `adw(...)` fails husky commit-msg.
 */
export const shipCommitMessage = (ticketId: string): string =>
  `chore(adw): ship pending changes for ${ticketId}`;

/**
 * **Ship agent** — Code agent (same class as Test agent): deterministic
 * commit-if-dirty → push → open PR from schema-decoded {@link ShipInput}.
 */
export const runShipAgent = (
  input: ShipInput
): Effect.Effect<ShipAgentResult, never, GitHost> =>
  Effect.gen(function* () {
    const gitHost = yield* GitHost;

    const commitResult = yield* gitHost
      .commitWorkingTree({
        cwd: input.cwd,
        message: shipCommitMessage(input.ticketId),
        env: input.env,
      })
      .pipe(Effect.exit);

    if (Exit.isFailure(commitResult)) {
      return {
        status: AdwStatus.ReadyForPr,
        detail: "Ship commit failed",
      } satisfies ShipAgentResult;
    }

    const pushResult = yield* gitHost
      .push({ cwd: input.cwd, branch: input.branch, env: input.env })
      .pipe(Effect.exit);

    if (Exit.isFailure(pushResult)) {
      return {
        status: AdwStatus.ReadyForPr,
        detail: "Ship push failed",
      } satisfies ShipAgentResult;
    }

    const prResult = yield* gitHost
      .openPullRequest({
        cwd: input.cwd,
        branch: input.branch,
        title: input.prTitle,
        body: input.prBody,
        env: input.env,
      })
      .pipe(Effect.exit);

    if (Exit.isFailure(prResult)) {
      return {
        status: AdwStatus.ReadyForPr,
        detail: "Ship open PR failed",
      } satisfies ShipAgentResult;
    }

    return {
      status: AdwStatus.Shipped,
      prUrl: prResult.value.url,
    } satisfies ShipAgentResult;
  });
