import { NodeServices } from "@effect/platform-node";
import {
  dockerSandboxProviderLayer,
  DOCKER_WORKSPACE_PATH,
} from "@lazy-software-factory/runtime";
import { Console, Effect, Layer, Option, Schema } from "effect";
import {
  CliConfig,
  CliError,
  Command,
  Flag,
  GlobalFlag,
} from "effect/unstable/cli";
import { AdwProgressStderrLive } from "./adw-progress.ts";
import {
  DEFAULT_ADW_RUNNER_IMAGE,
  resolveAdwRunnerImage,
} from "./docker-runner-image.ts";
import {
  exitCodeForStatus,
  formatOperatorResult,
  HostCliExitError,
  HostOperatorErrorTag,
  HostOperatorParseError,
  hostTicketIntakeLayer,
  loadHostDotEnv,
  mergeHostOperatorEnv,
  prepareHostOperatorSession,
  resolveHostOperatorAdwInput,
  runHostMinimalAdw,
  hostOperatorFsLayer,
  type HostOperatorFlagValues,
} from "./host-operator.ts";
import {
  hostOperatorFlagsFromCli,
  stripPnpmLeadingDashDash,
  type HostOperatorCliConfig,
} from "./host-operator-cli.ts";
import { runMinimalAdw, type MinimalAdwResult } from "./run-minimal-adw.ts";
import { TicketIntake, TicketIntakeError } from "./ticket-intake.ts";

export const OPERATOR_CLI_VERSION = "0.0.0";

export const AdwSandboxProviderKind = {
  Host: "host",
  Docker: "docker",
} as const;
export const AdwSandboxProviderKindSchema = Schema.Enum(AdwSandboxProviderKind);
export type AdwSandboxProviderKind = typeof AdwSandboxProviderKindSchema.Type;

const optionalStringFlag = (name: string, description: string) =>
  Flag.string(name).pipe(Flag.withDescription(description), Flag.optional);

const operatorFlagConfig = {
  sandbox: Flag.choice("sandbox", [
    AdwSandboxProviderKind.Host,
    AdwSandboxProviderKind.Docker,
  ]).pipe(
    Flag.withDescription(
      "Sandbox backend. Default: docker. Pass --sandbox host (or use adw-host) for the lightweight Host path."
    ),
    Flag.withDefault(AdwSandboxProviderKind.Docker)
  ),
  issue: optionalStringFlag(
    "issue",
    "GitHub Issue ref (number, #N, or URL). Or ADW_ISSUE after env load."
  ),
  ticket: optionalStringFlag("ticket", "Manual ticket id. Or ADW_TICKET_ID."),
  prompt: optionalStringFlag("prompt", "Manual Initial prompt. Or ADW_PROMPT."),
  repoUrl: optionalStringFlag(
    "repo-url",
    "Remote Git URL. Required for Docker (default); Host uses it when cwd has no .git."
  ),
  startingRef: optionalStringFlag(
    "starting-ref",
    "Optional branch or commit after clone (Docker remote intake)."
  ),
  cwd: optionalStringFlag(
    "cwd",
    "Host warm sandbox directory only. Rejected for Docker (default sandbox)."
  ),
};

export type OperatorCliConfig = {
  readonly sandbox: AdwSandboxProviderKind;
  readonly issue: Option.Option<string>;
  readonly ticket: Option.Option<string>;
  readonly prompt: Option.Option<string>;
  readonly repoUrl: Option.Option<string>;
  readonly startingRef: Option.Option<string>;
  readonly cwd: Option.Option<string>;
};

export const operatorFlagsFromCli = (
  config: OperatorCliConfig
): HostOperatorFlagValues & {
  readonly sandbox: AdwSandboxProviderKind;
  readonly startingRef?: string;
} => ({
  sandbox: config.sandbox,
  ...hostOperatorFlagsFromCli({
    issue: config.issue,
    ticket: config.ticket,
    prompt: config.prompt,
    repoUrl: config.repoUrl,
    cwd: config.cwd,
  }),
  ...(Option.getOrUndefined(config.startingRef)
    ? { startingRef: Option.getOrUndefined(config.startingRef) }
    : {}),
});

const OPERATOR_CLI_DESCRIPTION =
  "Run one Minimal ADW. Default --sandbox docker (isolated container worker; requires --repo-url; rejects --cwd). Pass --sandbox host or use adw-host for the lightweight Host path.";

const OPERATOR_CLI_EXAMPLES: ReadonlyArray<{
  readonly command: string;
  readonly description?: string;
}> = [
  {
    command: "adw --issue <n> --repo-url <url> [--starting-ref <ref>]",
    description: "Docker Minimal ADW (default sandbox)",
  },
  {
    command: "adw --sandbox host --issue <n> [--cwd <dir>]",
    description: "Host Minimal ADW (explicit; same as adw-host)",
  },
];

export const operatorCliConfigLayer = CliConfig.layer({
  builtIns: [GlobalFlag.Help, GlobalFlag.Version],
});

export const makeOperatorCommand = <E, R>(
  handler: (config: OperatorCliConfig) => Effect.Effect<void, E, R>
) =>
  Command.make("adw", operatorFlagConfig, handler).pipe(
    Command.withDescription(OPERATOR_CLI_DESCRIPTION),
    Command.withExamples(OPERATOR_CLI_EXAMPLES)
  );

/** Docker controller Layers: Docker lease + progress stderr. */
export const dockerMinimalAdwLayer = (
  image: string = DEFAULT_ADW_RUNNER_IMAGE
) =>
  Layer.mergeAll(dockerSandboxProviderLayer({ image }), AdwProgressStderrLive);

export const runDockerMinimalAdw = (
  input: {
    readonly ticketId: string;
    readonly prompt: string;
    readonly repoUrl: string;
    readonly startingRef?: string;
    readonly env?: Readonly<Record<string, string>>;
  },
  image: string = resolveAdwRunnerImage()
): Effect.Effect<MinimalAdwResult> =>
  runMinimalAdw({
    ticketId: input.ticketId,
    prompt: input.prompt,
    repoUrl: input.repoUrl,
    ...(input.startingRef ? { startingRef: input.startingRef } : {}),
    env: input.env,
  }).pipe(Effect.provide(dockerMinimalAdwLayer(image)));

/**
 * Load operator-machine credentials for Docker without aiming a Host cwd into
 * the sandbox (secrets still travel only on worker stdin via request.env).
 */
const prepareDockerOperatorEnv = (
  shell: NodeJS.ProcessEnv = process.env
): Effect.Effect<Record<string, string>, never, never> =>
  loadHostDotEnv(process.cwd()).pipe(
    Effect.provide(hostOperatorFsLayer),
    Effect.map((fileEnv) =>
      selectDockerWorkerEnv(mergeHostOperatorEnv(fileEnv, shell))
    ),
    Effect.orElseSucceed(() =>
      selectDockerWorkerEnv(mergeHostOperatorEnv({}, shell))
    )
  );

const dockerWorkerEnvKeys = [
  "CURSOR_API_KEY",
  "GH_TOKEN",
  "ADW_MODEL",
  "CURSOR_MODEL",
  "GH_HOST",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
] as const;

/** Keep host paths and unrelated credentials out of the Docker worker. */
export const selectDockerWorkerEnv = (
  env: Readonly<Record<string, string>>
): Record<string, string> =>
  Object.fromEntries(
    dockerWorkerEnvKeys.flatMap((key) =>
      env[key] === undefined ? [] : [[key, env[key]]]
    )
  );

const handleOperator = (config: OperatorCliConfig) =>
  Effect.gen(function* () {
    const flags = operatorFlagsFromCli(config);

    if (flags.sandbox === AdwSandboxProviderKind.Docker) {
      if (Option.isSome(config.cwd) || (process.env["ADW_CWD"] ?? "") !== "") {
        return yield* new HostOperatorParseError({
          message:
            "Docker sandbox rejects --cwd / ADW_CWD (no local dirty-tree bind mounts). Use --repo-url and optional --starting-ref.",
        });
      }
      const repoUrl =
        Option.getOrUndefined(config.repoUrl) ?? process.env["ADW_REPO_URL"];
      if (!repoUrl) {
        return yield* new HostOperatorParseError({
          message:
            "Docker sandbox requires --repo-url (or ADW_REPO_URL) for remote Git intake.",
        });
      }

      // Resolve ticket/prompt using Host session helpers against operator cwd
      // for intake only — do not pass cwd into Docker acquire.
      const session = yield* prepareHostOperatorSession({
        issue: Option.getOrUndefined(config.issue),
        ticket: Option.getOrUndefined(config.ticket),
        prompt: Option.getOrUndefined(config.prompt),
        repoUrl,
      });
      const input = yield* resolveHostOperatorAdwInput(session.args);
      const env = yield* prepareDockerOperatorEnv(session.env);

      const result = yield* runDockerMinimalAdw({
        ticketId: input.ticketId,
        prompt: input.prompt,
        repoUrl,
        ...(flags.startingRef ? { startingRef: flags.startingRef } : {}),
        env,
      });
      yield* Console.log(formatOperatorResult(result));
      const code = exitCodeForStatus(result.status);
      if (code !== 0) {
        return yield* new HostCliExitError({ code });
      }
      return;
    }

    const hostConfig: HostOperatorCliConfig = {
      issue: config.issue,
      ticket: config.ticket,
      prompt: config.prompt,
      repoUrl: config.repoUrl,
      cwd: config.cwd,
    };
    const session = yield* prepareHostOperatorSession(
      hostOperatorFlagsFromCli(hostConfig)
    );
    const input = yield* resolveHostOperatorAdwInput(session.args);
    const result = yield* runHostMinimalAdw({
      ticketId: input.ticketId,
      prompt: input.prompt,
      repoUrl: input.repoUrl,
      cwd: input.cwd ?? session.args.cwd,
      env: session.env,
      ...(flags.startingRef ? { startingRef: flags.startingRef } : {}),
    });
    yield* Console.log(formatOperatorResult(result));
    const code = exitCodeForStatus(result.status);
    if (code !== 0) {
      return yield* new HostCliExitError({ code });
    }
  });

export const operatorCommand = makeOperatorCommand(handleOperator);

export const runOperatorArgv = (
  argv: readonly string[]
): Effect.Effect<number, never, Command.Environment | TicketIntake> =>
  Command.runWith(operatorCommand, {
    version: OPERATOR_CLI_VERSION,
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

export const runOperatorMain = (
  argv: readonly string[] = process.argv.slice(2)
): Promise<number> =>
  Effect.runPromise(
    runOperatorArgv(argv).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          hostTicketIntakeLayer,
          operatorCliConfigLayer
        )
      )
    )
  );

export { DOCKER_WORKSPACE_PATH };
