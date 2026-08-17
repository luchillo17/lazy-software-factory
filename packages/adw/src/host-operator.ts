import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { GitHubGhLive } from "@lazy-software-factory/git-host";
import {
  CursorBuildAgentLive,
  CursorReviewAgentLive,
  SandboxProvider,
} from "@lazy-software-factory/runtime";
import {
  Config,
  ConfigProvider,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
} from "effect";
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
  /** Warm sandbox cwd (absolute after {@link resolveHostOperatorCwd}). */
  readonly cwd?: string;
}

/** Issue-ref intake (GitHub TicketIntake adapter). */
export interface HostOperatorIssueArgs {
  readonly issueRef: string;
  readonly repoUrl?: string;
  /** Warm sandbox cwd (absolute after {@link resolveHostOperatorCwd}). */
  readonly cwd?: string;
}

export type HostOperatorArgs = HostOperatorManualArgs | HostOperatorIssueArgs;

export const HostOperatorErrorTag = {
  HostCwdError: "HostCwdError",
  HostOperatorParseError: "HostOperatorParseError",
  HostCliExitError: "HostCliExitError",
} as const;

export const HostOperatorErrorTagSchema = Schema.Enum(HostOperatorErrorTag);

export class HostCwdError extends Schema.TaggedError<HostCwdError>()(
  HostOperatorErrorTag.HostCwdError,
  { message: Schema.String }
) {}

/** Missing required flags/env or exclusive `--issue` vs `--ticket`/`--prompt`. */
export class HostOperatorParseError extends Schema.TaggedError<HostOperatorParseError>()(
  HostOperatorErrorTag.HostOperatorParseError,
  { message: Schema.String }
) {}

/** ADW finished; process should exit with `code` (not 0). */
export class HostCliExitError extends Schema.TaggedError<HostCliExitError>()(
  HostOperatorErrorTag.HostCliExitError,
  { code: Schema.Number }
) {}

/** Flag values after CLI parse (env fallbacks applied later). */
export interface HostOperatorFlagValues {
  readonly ticket?: string;
  readonly prompt?: string;
  readonly issue?: string;
  readonly repoUrl?: string;
  readonly cwd?: string;
}

/** Node FileSystem + Path for Host cwd / `<cwd>/.env` (ADR-0003). */
export const hostOperatorFsLayer = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer
);

type HostEnvRecord = Readonly<Record<string, string | undefined>>;

const optionalEnv = (
  name: string,
  env: HostEnvRecord = process.env
): string | undefined =>
  Option.getOrUndefined(
    Effect.runSync(
      Config.option(Config.string(name))
        .parse(ConfigProvider.fromEnvRecord(env))
        .pipe(Effect.orElseSucceed(() => Option.none()))
    )
  );

/**
 * Resolve Host sandbox cwd to an absolute existing directory.
 * Omitting `cwd` uses `process.cwd()`. Relative paths resolve from the invoker cwd.
 */
export const resolveHostOperatorCwd = (
  cwd: string | undefined
): Effect.Effect<string, HostCwdError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const target =
      cwd === undefined || cwd === ""
        ? process.cwd()
        : path.resolve(process.cwd(), cwd);
    const info = yield* fs.stat(target).pipe(
      Effect.mapError(
        () =>
          new HostCwdError({
            message: `Host --cwd does not exist: ${target}`,
          })
      )
    );
    if (info.type !== "Directory") {
      return yield* new HostCwdError({
        message: `Host --cwd is not a directory: ${target}`,
      });
    }
    return target;
  });

const flattenDotEnvProvider = (
  provider: ConfigProvider.ConfigProvider,
  prefix: ReadonlyArray<string> = []
): Effect.Effect<Readonly<Record<string, string>>> =>
  Effect.gen(function* () {
    const node = yield* provider
      .load([...prefix])
      .pipe(Effect.orElseSucceed(() => undefined));
    if (node === undefined) {
      return {};
    }
    if (node._tag === "Value") {
      return prefix.length === 0 ? {} : { [prefix.join("_")]: node.value };
    }
    const out: Record<string, string> = {};
    if (node.value !== undefined && prefix.length > 0) {
      out[prefix.join("_")] = node.value;
    }
    const children =
      node._tag === "Record"
        ? node.keys
        : node._tag === "Array"
          ? Array.from({ length: node.length }, (_, i) => String(i))
          : [];
    for (const key of children) {
      Object.assign(
        out,
        yield* flattenDotEnvProvider(provider, [...prefix, key])
      );
    }
    return out;
  });

/**
 * Parse `<cwd>/.env` via {@link ConfigProvider.fromDotEnvContents}.
 * Missing or empty file → `{}`.
 */
export const loadHostDotEnv = (
  cwd: string
): Effect.Effect<
  Readonly<Record<string, string>>,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const contents = yield* fs
      .readFileString(path.join(cwd, ".env"))
      .pipe(Effect.orElseSucceed(() => ""));
    if (contents.trim() === "") {
      return {};
    }
    return yield* flattenDotEnvProvider(
      ConfigProvider.fromDotEnvContents(contents)
    );
  });

/** Shell env wins over file keys (ADR-0003). */
export const mergeHostOperatorEnv = (
  fileEnv: Readonly<Record<string, string>>,
  shell: HostEnvRecord
): Record<string, string> => {
  const merged: Record<string, string> = { ...fileEnv };
  for (const [key, value] of Object.entries(shell)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
};

const argvHasCwdFlag = (argv: readonly string[]): boolean => {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  for (const arg of args) {
    if (arg === "--cwd" || arg.startsWith("--cwd=")) {
      return true;
    }
  }
  return false;
};

/**
 * `adw-host` bin: when the caller omitted `--cwd` and `ADW_CWD`, inject the
 * invoker directory as `--cwd` so Host aims at the foreign tree even though the
 * bin loads Factory `tsx` / packages from this checkout.
 * Explicit `--cwd` / non-empty `ADW_CWD` win over the injected invoker path.
 */
export const prepareAdwHostArgv = (
  argv: readonly string[],
  invokerCwd: string,
  env: { readonly ADW_CWD?: string } = {}
): string[] => {
  const adwCwd = env.ADW_CWD;
  if (argvHasCwdFlag(argv) || (adwCwd !== undefined && adwCwd !== "")) {
    return [...argv];
  }
  if (argv[0] === "--") {
    return ["--", "--cwd", invokerCwd, ...argv.slice(1)];
  }
  return ["--cwd", invokerCwd, ...argv];
};

/**
 * Map parsed flags + env to Host operator args.
 * Env is the merged shell+file record (ADR-0003); flags win.
 */
export const hostOperatorArgsFromFlags = (
  flags: HostOperatorFlagValues,
  env: HostEnvRecord = process.env
): HostOperatorArgs | { readonly error: string } => {
  const ticketId = flags.ticket ?? optionalEnv("ADW_TICKET_ID", env);
  const prompt = flags.prompt ?? optionalEnv("ADW_PROMPT", env);
  const issueRef = flags.issue ?? optionalEnv("ADW_ISSUE", env);
  const repoUrl = flags.repoUrl ?? optionalEnv("ADW_REPO_URL", env);
  const cwd = flags.cwd ?? optionalEnv("ADW_CWD", env);

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
      ...(cwd ? { cwd } : {}),
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
    ...(cwd ? { cwd } : {}),
  };
};

export interface HostOperatorSession {
  readonly args: HostOperatorArgs;
  readonly env: Record<string, string>;
}

/**
 * Resolve cwd, load `<cwd>/.env`, then apply flag+env Host args.
 * Flags parse once; file env fills ADW_ISSUE / credentials after cwd is known.
 */
export const prepareHostOperatorSession = (
  flags: HostOperatorFlagValues,
  shell: HostEnvRecord = process.env
): Effect.Effect<
  HostOperatorSession,
  HostCwdError | HostOperatorParseError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const cwd = yield* resolveHostOperatorCwd(
      flags.cwd ?? optionalEnv("ADW_CWD", shell)
    );
    const env = mergeHostOperatorEnv(yield* loadHostDotEnv(cwd), shell);
    const parsed = hostOperatorArgsFromFlags(flags, env);
    if ("error" in parsed) {
      return yield* new HostOperatorParseError({ message: parsed.error });
    }
    const args: HostOperatorArgs = { ...parsed, cwd };
    return { args, env };
  });

const isIssueArgs = (args: HostOperatorArgs): args is HostOperatorIssueArgs =>
  "issueRef" in args;

type HostOperatorAdwFields = Pick<
  MinimalAdwInput,
  "ticketId" | "prompt" | "repoUrl" | "cwd"
>;

/**
 * Resolve Host CLI args to `runMinimalAdw` ticketId/prompt/repoUrl/cwd.
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
): Effect.Effect<HostOperatorAdwFields, TicketIntakeError, TicketIntake>;
export function resolveHostOperatorAdwInput(
  args: HostOperatorArgs
): Effect.Effect<HostOperatorAdwFields, TicketIntakeError, TicketIntake> {
  if (isIssueArgs(args)) {
    return Effect.gen(function* () {
      const intake = yield* TicketIntake;
      const ready = yield* intake.loadReadyTicket(args.issueRef, {
        cwd: args.cwd,
      });
      return {
        ticketId: ready.ticketId,
        prompt: ready.prompt,
        ...(args.repoUrl ? { repoUrl: args.repoUrl } : {}),
        ...(args.cwd ? { cwd: args.cwd } : {}),
      };
    });
  }

  return Effect.succeed({
    ticketId: args.ticketId,
    prompt: args.prompt,
    ...(args.repoUrl ? { repoUrl: args.repoUrl } : {}),
    ...(args.cwd ? { cwd: args.cwd } : {}),
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
