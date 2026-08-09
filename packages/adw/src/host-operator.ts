import { GitHubGhLive } from "@lazy-software-factory/git-host";
import {
  CursorBuildAgentLive,
  CursorReviewAgentLive,
  SandboxProvider,
} from "@lazy-software-factory/runtime";
import { Effect, Layer } from "effect";
import { parseArgs } from "node:util";
import { AdwBuildAttemptCap, AdwReviewAttemptCap } from "./attempt-caps.ts";
import { AdwStatus } from "./enums.ts";
import {
  runMinimalAdw,
  type MinimalAdwInput,
  type MinimalAdwResult,
} from "./run-minimal-adw.ts";
import { AdwTestCommands } from "./test-commands.ts";
import { WorkspaceProvision } from "./workspace-provision.ts";

export interface HostOperatorArgs {
  readonly ticketId: string;
  readonly prompt: string;
  readonly repoUrl?: string;
}

/** Parse argv flags: --ticket --prompt --repo-url (env fallbacks OK). */
export const parseHostOperatorArgs = (
  argv: readonly string[]
): HostOperatorArgs | { readonly error: string } | { readonly help: true } => {
  // `pnpm … -- --flags` leaves a leading `--` that would end option parsing.
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];

  let values: {
    ticket?: string;
    prompt?: string;
    "repo-url"?: string;
    help?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args,
      options: {
        ticket: { type: "string" },
        prompt: { type: "string" },
        "repo-url": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    return {
      error: err instanceof Error ? err.message.split("\n")[0]! : String(err),
    };
  }

  if (values.help) {
    return { help: true as const };
  }

  const ticketId = values.ticket ?? process.env["ADW_TICKET_ID"];
  const prompt = values.prompt ?? process.env["ADW_PROMPT"];
  const repoUrl = values["repo-url"] ?? process.env["ADW_REPO_URL"];

  if (!ticketId || !prompt) {
    return {
      error:
        "Missing --ticket / --prompt (or ADW_TICKET_ID / ADW_PROMPT). Use --help.",
    };
  }

  return {
    ticketId,
    prompt,
    ...(repoUrl ? { repoUrl } : {}),
  };
};

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /gh[pousr]_[A-Za-z0-9_]{20,}/gi,
  /github_pat_[A-Za-z0-9_]{20,}/gi,
  /CURSOR_API_KEY\s*[=:]\s*\S+/gi,
  /GH_TOKEN\s*[=:]\s*\S+/gi,
  /api[_-]?key\s*[=:]\s*\S+/gi,
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /x-access-token:[^\s@/]+/gi,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/gi,
];

/** Redact common credential shapes from operator-facing text. */
export const redactSecrets = (text: string): string => {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
};

/** Operator-facing one-line status (redacts secrets in detail). */
export const formatOperatorResult = (result: MinimalAdwResult): string => {
  const parts = [`status=${result.status}`, `ticket=${result.ticketId}`];
  if (result.prUrl) {
    parts.push(`pr=${result.prUrl}`);
  }
  if (result.detail) {
    parts.push(`detail=${redactSecrets(result.detail)}`);
  }
  if (result.sandboxId) {
    parts.push(`sandbox=${result.sandboxId}`);
  }
  return parts.join(" ");
};

/** Host Layers: warm sandbox, Cursor agents, GitHub host, provision, caps. */
export const hostMinimalAdwLayer = Layer.mergeAll(
  SandboxProvider.Host,
  CursorBuildAgentLive,
  CursorReviewAgentLive,
  GitHubGhLive,
  WorkspaceProvision.Host.pipe(Layer.provide(GitHubGhLive)),
  Layer.succeed(
    AdwTestCommands,
    AdwTestCommands.of({
      commands: [
        {
          command: "pnpm",
          args: [
            "nx",
            "run-many",
            "-t",
            "typecheck",
            "-p",
            "adw,runtime,git-host",
          ],
        },
      ],
    })
  ),
  AdwBuildAttemptCap.Default,
  AdwReviewAttemptCap.Default
);

/**
 * Run one Host minimal ADW. Credentials from `input.env` / process env
 * (CURSOR_API_KEY, GH_TOKEN). Host enforces single ADW at a time.
 */
export const runHostMinimalAdw = (
  input: MinimalAdwInput
): Effect.Effect<MinimalAdwResult> =>
  runMinimalAdw(input).pipe(Effect.provide(hostMinimalAdwLayer));

/** Promise entry for the thin `scripts/run-minimal-adw.ts` wrapper. */
export const runHostMinimalAdwPromise = (
  input: MinimalAdwInput
): Promise<MinimalAdwResult> => Effect.runPromise(runHostMinimalAdw(input));

export const exitCodeForStatus = (
  status: MinimalAdwResult["status"]
): number => {
  switch (status) {
    case AdwStatus.Shipped:
      return 0;
    case AdwStatus.ReadyForPr:
      return 2;
    case AdwStatus.Failed:
    case AdwStatus.NotImplemented:
      return 1;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
};
