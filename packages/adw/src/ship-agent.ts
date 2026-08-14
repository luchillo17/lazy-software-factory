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

/** GitHub Issue closing keywords (v0 forge). */
const GITHUB_ISSUE_CLOSING_KEYWORD =
  /(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+#(\d+)\b/gi;

/**
 * PR body for Ship open: when `ticketId` is a numeric GitHub Issue id, ensure
 * a closing keyword so the PR links (and later closes) that Issue. Idempotent
 * if Review already included one. Non-numeric manual tickets stay unchanged.
 */
export const shipPrBody = (ticketId: string, prBody: string): string => {
  if (!/^\d+$/.test(ticketId)) {
    return prBody;
  }

  for (const match of prBody.matchAll(GITHUB_ISSUE_CLOSING_KEYWORD)) {
    if (match[1] === ticketId) {
      return prBody;
    }
  }

  const trimmed = prBody.replace(/\s+$/u, "");
  return `${trimmed}\n\nCloses #${ticketId}`;
};

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
        body: shipPrBody(input.ticketId, input.prBody),
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
