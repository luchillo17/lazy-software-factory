import { Context, Effect, Layer, Schema } from "effect";
import { runCapturedProcess } from "./run-captured-process.ts";
import { SandboxCreateError } from "./errors.ts";

export const DockerCliErrorTag = {
  DockerCliError: "DockerCliError",
} as const;
export const DockerCliErrorTagSchema = Schema.Enum(DockerCliErrorTag);

/** Typed failure from the Docker CLI process seam. */
export class DockerCliError extends Schema.TaggedError<DockerCliError>()(
  DockerCliErrorTag.DockerCliError,
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
    exitCode: Schema.optionalKey(Schema.Number),
    stderr: Schema.optionalKey(Schema.String),
  }
) {}

export interface DockerCliRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface DockerCliService {
  /**
   * Run `docker` with argv. Parses nothing — callers use machine-readable
   * flags (`--format`, `--quiet`) and parse stdout themselves.
   */
  readonly run: (options: {
    readonly args: readonly string[];
    /** When set, merged onto process env (never log secrets). */
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly stdin?: string | Uint8Array;
    readonly timeoutMs?: number;
  }) => Effect.Effect<DockerCliRunResult, DockerCliError>;
}

/** Installed Docker CLI over the captured-process seam. */
export class DockerCli extends Context.Service<DockerCli, DockerCliService>()(
  "@lazy-software-factory/runtime/DockerCli"
) {
  static readonly layer = (options?: {
    readonly command?: string;
    readonly context?: string;
  }) =>
    Layer.succeed(
      DockerCli,
      DockerCli.of({
        run: ({ args, env, stdin, timeoutMs }) =>
          Effect.gen(function* () {
            const command = options?.command ?? "docker";
            const fullArgs =
              options?.context !== undefined && options.context.length > 0
                ? ["--context", options.context, ...args]
                : [...args];
            const result = yield* runCapturedProcess({
              command,
              args: fullArgs,
              env,
              stdin,
              timeoutMs,
              extendEnv: env !== undefined,
            }).pipe(
              Effect.mapError(
                (cause) =>
                  new DockerCliError({
                    message: `Failed to spawn Docker CLI (${command})`,
                    cause,
                  })
              )
            );
            return result;
          }),
      })
    );
}

/** Fail when Docker CLI exits non-zero; include redacted stderr in message. */
export const requireDockerOk = (
  result: DockerCliRunResult,
  label: string
): Effect.Effect<DockerCliRunResult, DockerCliError> =>
  result.exitCode === 0
    ? Effect.succeed(result)
    : Effect.fail(
        new DockerCliError({
          message: `${label} failed (exit ${result.exitCode}): ${
            result.stderr.trim() || result.stdout.trim() || "no output"
          }`,
          exitCode: result.exitCode,
          stderr: result.stderr,
        })
      );

/** Map Docker CLI errors into SandboxCreateError for acquire paths. */
export const dockerCliToCreateError = (
  err: DockerCliError
): SandboxCreateError =>
  new SandboxCreateError({
    message: err.message,
    cause: err,
  });

/** Parse `docker … --format '{{json .}}'` line-delimited JSON objects. */
export const parseDockerJsonLines = <A>(
  stdout: string,
  decodeOne: (raw: unknown) => Effect.Effect<A, DockerCliError>
): Effect.Effect<ReadonlyArray<A>, DockerCliError> =>
  Effect.gen(function* () {
    const lines = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const out: A[] = [];
    for (const line of lines) {
      const raw = yield* Effect.try({
        try: () => JSON.parse(line) as unknown,
        catch: (cause) =>
          new DockerCliError({
            message: "Docker CLI returned non-JSON machine output",
            cause,
          }),
      });
      out.push(yield* decodeOne(raw));
    }
    return out;
  });

/** Parse a single JSON document from Docker CLI stdout. */
export const parseDockerJson = <A>(
  stdout: string,
  decodeOne: (raw: unknown) => Effect.Effect<A, DockerCliError>
): Effect.Effect<A, DockerCliError> =>
  Effect.gen(function* () {
    const trimmed = stdout.trim();
    if (trimmed.length === 0) {
      return yield* new DockerCliError({
        message: "Docker CLI returned empty machine output",
      });
    }
    const raw = yield* Effect.try({
      try: () => JSON.parse(trimmed) as unknown,
      catch: (cause) =>
        new DockerCliError({
          message: "Docker CLI returned non-JSON machine output",
          cause,
        }),
    });
    return yield* decodeOne(raw);
  });
