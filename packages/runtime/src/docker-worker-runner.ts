import {
  ADW_WORKER_PROTOCOL_VERSION,
  AdwWorkerFrameKind,
  AdwWorkerProtocolError,
  decodeWorkerFrame,
  encodeWorkerHandshake,
} from "@lazy-software-factory/adw-worker";
import { Effect, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";
import type { WorkerProcessLaunch } from "./host-worker-runner.ts";
import { SandboxWorkerError } from "./errors.ts";
import { NodeChildProcessLive } from "./run-captured-process.ts";

const textEncoder = new TextEncoder();

/**
 * Probe a runner image with handshake only (no secret-bearing request).
 * Custom images must pass this before secrets or repository work begin.
 */
export const runDockerWorkerHandshake = (options: {
  readonly launch: WorkerProcessLaunch;
  readonly terminateGrace?: `${number} seconds` | `${number} millis`;
}): Effect.Effect<void, SandboxWorkerError | AdwWorkerProtocolError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(
        options.launch.command,
        [...options.launch.args],
        { stdin: "pipe" }
      ).pipe(
        Effect.mapError(
          (cause) =>
            new SandboxWorkerError({
              message: "Failed to spawn Docker worker handshake probe",
              cause,
            })
        )
      );

      yield* Stream.run(
        Stream.succeed(textEncoder.encode(encodeWorkerHandshake())),
        handle.stdin
      ).pipe(
        Effect.mapError(
          (cause) =>
            new SandboxWorkerError({
              message: "Failed to write handshake probe to Docker worker",
              cause,
            })
        )
      );

      let ok = false;
      yield* handle.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.mapEffect((line) =>
          Effect.gen(function* () {
            if (line.trim().length === 0) {
              return;
            }
            const frame = yield* decodeWorkerFrame(line);
            if (frame.kind !== AdwWorkerFrameKind.HandshakeOk) {
              return yield* new SandboxWorkerError({
                message: `Docker worker handshake probe expected handshake_ok, got ${frame.kind}`,
              });
            }
            if (frame.protocolVersion !== ADW_WORKER_PROTOCOL_VERSION) {
              return yield* new SandboxWorkerError({
                message: "Docker worker handshake probe protocol mismatch",
              });
            }
            ok = true;
          })
        ),
        Stream.takeUntil(() => ok),
        Stream.runDrain,
        Effect.mapError((cause) =>
          cause instanceof AdwWorkerProtocolError ||
          cause instanceof SandboxWorkerError
            ? cause
            : new SandboxWorkerError({
                message: "Docker worker handshake probe failed",
                cause,
              })
        ),
        Effect.timeout(options.terminateGrace ?? "15 seconds"),
        Effect.catchTag("TimeoutError", () =>
          Effect.fail(
            new SandboxWorkerError({
              message: "Docker worker handshake probe timed out",
            })
          )
        )
      );

      yield* handle
        .kill({ killSignal: "SIGTERM" })
        .pipe(Effect.catch(() => Effect.void));

      if (!ok) {
        return yield* new SandboxWorkerError({
          message: "Docker worker handshake probe did not emit handshake_ok",
        });
      }
    })
  ).pipe(Effect.provide(NodeChildProcessLive));
