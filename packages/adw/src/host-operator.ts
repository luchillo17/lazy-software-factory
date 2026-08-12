import { GitHubGhLive } from "@lazy-software-factory/git-host";
import {
  CursorBuildAgentLive,
  CursorReviewAgentLive,
  SandboxProvider,
} from "@lazy-software-factory/runtime";
import { Config, ConfigProvider, Effect, Layer, Option } from "effect";
import { parseArgs } from "node:util";
import {
  AdwBuildAttemptCap,
  AdwReviewAttemptCap,
  AdwSchemaResumeCap,
} from "./attempt-caps.ts";
import { AdwProgressStderrLive } from "./adw-progress.ts";
import { AdwStatus } from "./enums.ts";
import { GitHubTicketIntakeLive } from "./github-ticket-intake.ts";
import {
  runMinimalAdw,
  type MinimalAdwInput,
  type MinimalAdwResult,
} from "./run-minimal-adw.ts";
import { redactSecrets } from "./redact-secrets.ts";
import { AdwTestCommands } from "./test-commands.ts";
import { TicketIntake, type TicketIntakeError } from "./ticket-intake.ts";
import { resolvePackageJsonTestCommands } from "./package-json-test-commands.ts";
import { WorkspaceProvision } from "./workspace-provision.ts";

export { redactSecrets } from "./redact-secrets.ts";

/** Manual ticket/prompt flags. */
export interface HostOperatorManualArgs {
  readonly ticketId: string;
  readonly prompt: string;
  readonly repoUrl?: string;
}

/** Issue-ref intake (GitHub TicketIntake adapter). */
export interface HostOperatorIssueArgs {
  readonly issueRef: string;
  readonly repoUrl?: string;
}

export type HostOperatorArgs = HostOperatorManualArgs | HostOperatorIssueArgs;

const optionalEnv = (name: string): string | undefined =>
  Option.getOrUndefined(
    Effect.runSync(
      Config.option(Config.string(name))
        .parse(ConfigProvider.fromEnvRecord(process.env))
        .pipe(Effect.orElseSucceed(() => Option.none()))
    )
  );

/** Parse argv flags: --ticket/--prompt or --issue, plus --repo-url. */
export const parseHostOperatorArgs = (
  argv: readonly string[]
): HostOperatorArgs | { readonly error: string } | { readonly help: true } => {
  // `pnpm … -- --flags` leaves a leading `--` that would end option parsing.
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];

  let values: {
    ticket?: string;
    prompt?: string;
    issue?: string;
    "repo-url"?: string;
    help?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args,
      options: {
        ticket: { type: "string" },
        prompt: { type: "string" },
        issue: { type: "string" },
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

  const ticketId = values.ticket ?? optionalEnv("ADW_TICKET_ID");
  const prompt = values.prompt ?? optionalEnv("ADW_PROMPT");
  const issueRef = values.issue ?? optionalEnv("ADW_ISSUE");
  const repoUrl = values["repo-url"] ?? optionalEnv("ADW_REPO_URL");

  if (issueRef && (ticketId || prompt)) {
    return {
      error:
        "Use either --issue (or ADW_ISSUE) or --ticket/--prompt, not both.",
    };
  }

  if (issueRef) {
    return {
      issueRef,
      ...(repoUrl ? { repoUrl } : {}),
    };
  }

  if (!ticketId || !prompt) {
    return {
      error:
        "Missing --issue (or ADW_ISSUE), or --ticket / --prompt (or ADW_TICKET_ID / ADW_PROMPT). Use --help.",
    };
  }

  return {
    ticketId,
    prompt,
    ...(repoUrl ? { repoUrl } : {}),
  };
};

const isIssueArgs = (args: HostOperatorArgs): args is HostOperatorIssueArgs =>
  "issueRef" in args;

type HostOperatorAdwFields = Pick<
  MinimalAdwInput,
  "ticketId" | "prompt" | "repoUrl"
>;

/**
 * Resolve Host CLI args to `runMinimalAdw` ticketId/prompt/repoUrl.
 * Issue refs load through {@link TicketIntake}.
 */
export function resolveHostOperatorAdwInput(
  args: HostOperatorIssueArgs
): Effect.Effect<HostOperatorAdwFields, TicketIntakeError, TicketIntake>;
export function resolveHostOperatorAdwInput(
  args: HostOperatorManualArgs
): Effect.Effect<HostOperatorAdwFields>;
export function resolveHostOperatorAdwInput(
  args: HostOperatorArgs
): Effect.Effect<HostOperatorAdwFields, TicketIntakeError, TicketIntake> {
  if (isIssueArgs(args)) {
    return Effect.gen(function* () {
      const intake = yield* TicketIntake;
      const ready = yield* intake.loadReadyTicket(args.issueRef);
      return {
        ticketId: ready.ticketId,
        prompt: ready.prompt,
        ...(args.repoUrl ? { repoUrl: args.repoUrl } : {}),
      };
    });
  }

  return Effect.succeed({
    ticketId: args.ticketId,
    prompt: args.prompt,
    ...(args.repoUrl ? { repoUrl: args.repoUrl } : {}),
  });
}

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

/** Live GitHub Issues TicketIntake (`gh` + GhRunner) for Host CLI. */
export const hostTicketIntakeLayer = GitHubTicketIntakeLive;

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
      resolve: resolvePackageJsonTestCommands,
    })
  ),
  AdwBuildAttemptCap.Default,
  AdwReviewAttemptCap.Default,
  AdwSchemaResumeCap.Default,
  AdwProgressStderrLive
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
