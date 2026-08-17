import { NodeServices } from "@effect/platform-node";
import { Console, Effect, Layer, Option, Ref } from "effect";
import {
  CliConfig,
  CliError,
  Command,
  Flag,
  GlobalFlag,
} from "effect/unstable/cli";
import {
  exitCodeForStatus,
  formatOperatorResult,
  HostCliExitError,
  HostOperatorErrorTag,
  hostTicketIntakeLayer,
  prepareHostOperatorSession,
  resolveHostOperatorAdwInput,
  runHostMinimalAdw,
  type HostOperatorFlagValues,
} from "./host-operator.ts";
import { TicketIntake, TicketIntakeError } from "./ticket-intake.ts";

export const HOST_OPERATOR_CLI_VERSION = "0.0.0";

/** `pnpm … -- --flags` leaves a leading `--` that ends Effect CLI option parsing. */
export const stripPnpmLeadingDashDash = (argv: readonly string[]): string[] =>
  argv[0] === "--" ? [...argv.slice(1)] : [...argv];

const optionalStringFlag = (name: string, description: string) =>
  Flag.string(name).pipe(Flag.withDescription(description), Flag.optional);

const hostOperatorFlagConfig = {
  issue: optionalStringFlag(
    "issue",
    "GitHub Issue ref (number, #N, or URL). Or ADW_ISSUE after <cwd>/.env."
  ),
  ticket: optionalStringFlag(
    "ticket",
    "Manual ticket id. Or ADW_TICKET_ID after <cwd>/.env."
  ),
  prompt: optionalStringFlag(
    "prompt",
    "Manual Initial prompt. Or ADW_PROMPT after <cwd>/.env."
  ),
  repoUrl: optionalStringFlag(
    "repo-url",
    "Remote URL for provision when the aimed cwd has no .git (ADR-0010)."
  ),
  cwd: optionalStringFlag(
    "cwd",
    "Warm sandbox directory. Or ADW_CWD. Default: process cwd. Relative paths resolve from the invoker directory."
  ),
};

export type HostOperatorCliConfig = {
  readonly issue: Option.Option<string>;
  readonly ticket: Option.Option<string>;
  readonly prompt: Option.Option<string>;
  readonly repoUrl: Option.Option<string>;
  readonly cwd: Option.Option<string>;
};

export const hostOperatorFlagsFromCli = (
  config: HostOperatorCliConfig
): HostOperatorFlagValues => ({
  ...(Option.getOrUndefined(config.issue)
    ? { issue: Option.getOrUndefined(config.issue) }
    : {}),
  ...(Option.getOrUndefined(config.ticket)
    ? { ticket: Option.getOrUndefined(config.ticket) }
    : {}),
  ...(Option.getOrUndefined(config.prompt)
    ? { prompt: Option.getOrUndefined(config.prompt) }
    : {}),
  ...(Option.getOrUndefined(config.repoUrl)
    ? { repoUrl: Option.getOrUndefined(config.repoUrl) }
    : {}),
  ...(Option.getOrUndefined(config.cwd)
    ? { cwd: Option.getOrUndefined(config.cwd) }
    : {}),
});

const HOST_OPERATOR_CLI_DESCRIPTION =
  "Run one Host Minimal ADW. Host cwd: --cwd / ADW_CWD (default: process cwd). Relative paths resolve from the invoker directory. Footgun: --repo-url does not replace an existing .git in that cwd (ADR-0010 reuse). Aim with --cwd, not --repo-url from a Factory checkout. Issue intake requires ready-for-agent. Credentials from <cwd>/.env / env (CURSOR_API_KEY, GH_TOKEN) — never printed. Local SDK model: ADW_MODEL / CURSOR_MODEL (default grok-4.5).";

const HOST_OPERATOR_CLI_EXAMPLES: ReadonlyArray<{
  readonly command: string;
  readonly description?: string;
}> = [
  {
    command: "adw-host --issue <n|#N|url> [--cwd <dir>] [--repo-url <url>]",
    description: "Issue intake on an aimed tree",
  },
  {
    command:
      "pnpm adw:host -- --issue <n|#N|url> [--cwd <dir>] [--repo-url <url>]",
    description: "Same via the Factory checkout script (note the extra --)",
  },
  {
    command:
      "pnpm adw:host -- --ticket <id> --prompt <text> [--cwd <dir>] [--repo-url <url>]",
    description: "Manual ticket/prompt bypasses intake",
  },
];

/** Help + version only — skip wizard/completions on the Host operator. */
export const hostOperatorCliConfigLayer = CliConfig.layer({
  builtIns: [GlobalFlag.Help, GlobalFlag.Version],
});

export const makeHostOperatorCommand = <E, R>(
  handler: (config: HostOperatorCliConfig) => Effect.Effect<void, E, R>
) =>
  Command.make("adw-host", hostOperatorFlagConfig, handler).pipe(
    Command.withDescription(HOST_OPERATOR_CLI_DESCRIPTION),
    Command.withExamples(HOST_OPERATOR_CLI_EXAMPLES)
  );

const handleHostOperator = (config: HostOperatorCliConfig) =>
  Effect.gen(function* () {
    const session = yield* prepareHostOperatorSession(
      hostOperatorFlagsFromCli(config)
    );
    const input = yield* resolveHostOperatorAdwInput(session.args);
    const result = yield* runHostMinimalAdw({
      ticketId: input.ticketId,
      prompt: input.prompt,
      repoUrl: input.repoUrl,
      cwd: input.cwd ?? session.args.cwd,
      env: session.env,
    });
    yield* Console.log(formatOperatorResult(result));
    const code = exitCodeForStatus(result.status);
    if (code !== 0) {
      return yield* new HostCliExitError({ code });
    }
  });

export const hostOperatorCommand = makeHostOperatorCommand(handleHostOperator);

/** Parse argv into flags without running ADW (tests / tracers). */
export const parseHostOperatorCliFlags = (
  argv: readonly string[]
): Effect.Effect<
  HostOperatorFlagValues,
  CliError.CliError,
  Command.Environment
> =>
  Effect.gen(function* () {
    const captured = yield* Ref.make<HostOperatorFlagValues | undefined>(
      undefined
    );
    yield* Command.runWith(
      makeHostOperatorCommand((config) =>
        Ref.set(captured, hostOperatorFlagsFromCli(config))
      ),
      { version: HOST_OPERATOR_CLI_VERSION }
    )(stripPnpmLeadingDashDash(argv));
    const flags = yield* Ref.get(captured);
    if (flags === undefined) {
      return yield* Effect.die("Host CLI handler did not run");
    }
    return flags;
  });

export const runHostOperatorArgv = (
  argv: readonly string[]
): Effect.Effect<number, never, Command.Environment | TicketIntake> =>
  Command.runWith(hostOperatorCommand, {
    version: HOST_OPERATOR_CLI_VERSION,
  })(stripPnpmLeadingDashDash(argv)).pipe(
    Effect.as(0),
    Effect.catchTag(HostOperatorErrorTag.HostCliExitError, (error) =>
      Effect.succeed(error.code)
    ),
    Effect.catchTag(HostOperatorErrorTag.HostCwdError, (error) =>
      Console.error(error.message).pipe(Effect.as(1))
    ),
    Effect.catchTag(HostOperatorErrorTag.HostOperatorParseError, (error) =>
      Console.error(error.message).pipe(Effect.as(1))
    ),
    Effect.catchIf(
      (error): error is TicketIntakeError => error instanceof TicketIntakeError,
      (error) => Console.error(error.message).pipe(Effect.as(1))
    ),
    Effect.catchIf(CliError.isCliError, () => Effect.succeed(1))
  );

/** Live Host operator: Node services, GitHub intake, Help/Version only. */
export const runHostOperatorMain = (
  argv: readonly string[] = process.argv.slice(2)
): Promise<number> =>
  Effect.runPromise(
    runHostOperatorArgv(argv).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          hostTicketIntakeLayer,
          hostOperatorCliConfigLayer
        )
      )
    )
  );
