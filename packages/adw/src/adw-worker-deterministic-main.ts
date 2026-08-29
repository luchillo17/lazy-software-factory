/**
 * Deterministic ADW worker entry for Docker integration images.
 * No Cursor SDK import — keeps the compiled bundle free of native helpers.
 */
import {
  ADW_WORKER_PROTOCOL_VERSION,
  AdwWorkerCapability,
  AdwWorkerFrameKind,
  AdwWorkerIsolation,
  AdwWorkerSupportLevel,
  AdwWorkerTerminalKind,
  decodeWorkerHandshake,
  decodeWorkerRequest,
  encodeWorkerFrame,
  redactWorkerDiagnostics,
  type AdwWorkerEffectiveCapabilities,
} from "@lazy-software-factory/adw-worker";
import { SandboxProvider } from "@lazy-software-factory/runtime/sandbox-provider";
import { Effect, Layer, Logger, Schema } from "effect";
import { AdwProgressSink } from "./adw-progress.ts";
import {
  AdwBuildAttemptCap,
  AdwReviewAttemptCap,
  AdwSchemaResumeCap,
} from "./attempt-caps.ts";
import {
  DeterministicAgentLive,
  DeterministicGitHostLive,
  DeterministicTestCommandsLive,
} from "./deterministic-worker-adapters.ts";
import { runMinimalAdwGraph } from "./run-minimal-adw-graph.ts";
import { installWorkerProtocolStdoutGuard } from "./worker-stdio.ts";
import { createStdinLineReader } from "./worker-stdin.ts";
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
  isolation: AdwWorkerIsolation.Container,
  retainedWorkspaces: AdwWorkerSupportLevel.Unsupported,
  diskQuota: AdwWorkerSupportLevel.Unsupported,
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

const workerGraphLayer = Layer.mergeAll(
  SandboxProvider.Local,
  DeterministicAgentLive,
  DeterministicGitHostLive,
  WorkspaceProvision.Host.pipe(Layer.provide(DeterministicGitHostLive)),
  DeterministicTestCommandsLive,
  AdwBuildAttemptCap.Default,
  AdwReviewAttemptCap.Default,
  AdwSchemaResumeCap.Default,
  Layer.succeed(
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
  ),
  Logger.layer([diagnosticsLogger])
);

const stdin = createStdinLineReader();

const run = Effect.gen(function* () {
  const handshakeLine = yield* Effect.tryPromise({
    try: () => stdin.readLine(),
    catch: (cause) =>
      new AdwWorkerMainError({
        message: "Failed to read worker handshake from stdin",
        cause,
      }),
  });

  yield* decodeWorkerHandshake(handshakeLine).pipe(
    Effect.mapError(
      (cause) =>
        new AdwWorkerMainError({
          message: cause.message,
          cause,
        })
    )
  );

  writeFrame({
    protocolVersion: ADW_WORKER_PROTOCOL_VERSION,
    kind: AdwWorkerFrameKind.HandshakeOk,
  });

  const line = yield* Effect.tryPromise({
    try: () => stdin.readLine(),
    catch: (cause) =>
      new AdwWorkerMainError({
        message: "Failed to read worker request from stdin",
        cause,
      }),
  });

  stdin.close();

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
    ...(request.startingRef ? { startingRef: request.startingRef } : {}),
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
