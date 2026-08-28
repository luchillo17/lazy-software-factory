/**
 * Versioned ADW worker process entry.
 *
 * Protocol: one JSON request line on stdin; newline-framed machine messages on
 * stdout; redacted diagnostics on stderr. Runs the Minimal ADW graph with
 * SandboxProvider.Local so Cursor local SDK and gates share this cwd.
 */
import {
  ADW_WORKER_PROTOCOL_VERSION,
  AdwWorkerCapability,
  AdwWorkerFrameKind,
  AdwWorkerIsolation,
  AdwWorkerTerminalKind,
  decodeWorkerRequest,
  encodeWorkerFrame,
  redactWorkerDiagnostics,
  type AdwWorkerEffectiveCapabilities,
} from "@lazy-software-factory/adw-worker";
import { GitHubGhLive } from "@lazy-software-factory/git-host";
import {
  CursorBuildAgentLive,
  CursorReviewAgentLive,
  SandboxProvider,
} from "@lazy-software-factory/runtime";
import { Effect, Layer, Logger, Schema } from "effect";
import { createInterface } from "node:readline";
import { AdwProgressSink } from "./adw-progress.ts";
import {
  AdwBuildAttemptCap,
  AdwReviewAttemptCap,
  AdwSchemaResumeCap,
} from "./attempt-caps.ts";
import { resolvePackageJsonTestCommands } from "./package-json-test-commands.ts";
import { runMinimalAdwGraph } from "./run-minimal-adw-graph.ts";
import { AdwTestCommands } from "./test-commands.ts";
import { installWorkerProtocolStdoutGuard } from "./worker-stdio.ts";
import { WorkspaceProvision } from "./workspace-provision.ts";

const AdwWorkerMainErrorTag = {
  AdwWorkerMainError: "AdwWorkerMainError",
} as const;
const AdwWorkerMainErrorTagSchema = Schema.Enum(AdwWorkerMainErrorTag);
void AdwWorkerMainErrorTagSchema;

class AdwWorkerMainError extends Schema.TaggedError<AdwWorkerMainError>()(
  AdwWorkerMainErrorTag.AdwWorkerMainError,
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

const workerCapabilities: AdwWorkerEffectiveCapabilities = {
  capabilities: [
    AdwWorkerCapability.CursorLocalAgent,
    AdwWorkerCapability.GitHostCli,
    AdwWorkerCapability.WorkspaceExec,
    AdwWorkerCapability.SkillPackMount,
  ],
  maxConcurrentLeases: 1,
  isolation: AdwWorkerIsolation.Host,
};

const protocolStdout = installWorkerProtocolStdoutGuard(
  process.stdout,
  process.stderr
);

const writeFrame = (frame: Parameters<typeof encodeWorkerFrame>[0]): void => {
  protocolStdout.writeProtocol(encodeWorkerFrame(frame));
};

const diagnosticsLogger: Logger.Logger<unknown, void> = Logger.make(
  (options) => {
    const message = Array.isArray(options.message)
      ? options.message
      : [options.message];
    const line = message
      .map((part) => (typeof part === "string" ? part : String(part)))
      .join(" ");
    if (line.length > 0) {
      process.stderr.write(`${redactWorkerDiagnostics(line)}\n`);
    }
  }
);

const progressSinkLayer = Layer.succeed(
  AdwProgressSink,
  AdwProgressSink.of({
    emit: (event) =>
      Effect.sync(() => {
        writeFrame({
          protocolVersion: ADW_WORKER_PROTOCOL_VERSION,
          kind: AdwWorkerFrameKind.Progress,
          event,
        });
      }),
  })
);

const workerGraphLayer = Layer.mergeAll(
  SandboxProvider.Local,
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
  progressSinkLayer,
  Logger.layer([diagnosticsLogger])
);

const readStdinLine = (): Promise<string> =>
  new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    const onLine = (line: string) => {
      cleanup();
      resolve(line);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("ADW worker stdin closed before request"));
    };
    const cleanup = () => {
      rl.off("line", onLine);
      rl.off("close", onClose);
      rl.close();
    };
    rl.once("line", onLine);
    rl.once("close", onClose);
  });

const run = Effect.gen(function* () {
  const line = yield* Effect.tryPromise({
    try: () => readStdinLine(),
    catch: (cause) =>
      new AdwWorkerMainError({
        message: "Failed to read worker request from stdin",
        cause,
      }),
  });

  const request = yield* decodeWorkerRequest(line).pipe(
    Effect.mapError(
      (cause) =>
        new AdwWorkerMainError({
          message: cause.message,
          cause,
        })
    )
  );

  const result = yield* runMinimalAdwGraph({
    ticketId: request.ticketId,
    prompt: request.prompt,
    cwd: request.cwd,
    ...(request.repoUrl ? { repoUrl: request.repoUrl } : {}),
    ...(request.env ? { env: request.env } : {}),
  });

  writeFrame({
    protocolVersion: ADW_WORKER_PROTOCOL_VERSION,
    kind: AdwWorkerFrameKind.Terminal,
    outcome: {
      kind: AdwWorkerTerminalKind.Completed,
      result,
      effectiveCapabilities: workerCapabilities,
    },
  });
}).pipe(
  Effect.provide(workerGraphLayer),
  Effect.catch((err) =>
    Effect.sync(() => {
      const detail =
        typeof err === "object" &&
        err !== null &&
        "message" in err &&
        typeof (err as { message: unknown }).message === "string"
          ? (err as { message: string }).message
          : String(err);
      process.stderr.write(`${redactWorkerDiagnostics(detail)}\n`);
      writeFrame({
        protocolVersion: ADW_WORKER_PROTOCOL_VERSION,
        kind: AdwWorkerFrameKind.Terminal,
        outcome: {
          kind: AdwWorkerTerminalKind.InfrastructureFailed,
          detail,
          effectiveCapabilities: workerCapabilities,
        },
      });
      process.exitCode = 1;
    })
  )
);

await Effect.runPromise(run);
