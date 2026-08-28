import {
  AdwWorkerFrameKind,
  AdwWorkerErrorTag,
  AdwWorkerProtocolError,
  AdwWorkerTerminalKind,
  decodeWorkerFrame,
  encodeWorkerRequest,
  redactWorkerDiagnostics,
  type AdwWorkerProgressEvent,
  type AdwWorkerRequest,
  type AdwWorkerTerminalOutcome,
} from "@lazy-software-factory/adw-worker";
import { Effect, Fiber, Stream } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { ChildProcess } from "effect/unstable/process";
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner";
import { SandboxWorkerError } from "./errors.ts";
import { NodeChildProcessLive } from "./run-captured-process.ts";

export interface HostWorkerLaunch {
  readonly command: string;
  readonly args: readonly string[];
}

export interface RunHostWorkerOptions {
  readonly launch: HostWorkerLaunch;
  readonly request: AdwWorkerRequest;
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly onProgress: (event: AdwWorkerProgressEvent) => Effect.Effect<void>;
  readonly onSpawn?: (handle: ChildProcessHandle) => void;
  readonly onSettle?: (handle: ChildProcessHandle) => void;
  /** Grace after SIGTERM before SIGKILL (default 5s). */
  readonly terminateGrace?: `${number} seconds` | `${number} millis`;
}

const textEncoder = new TextEncoder();

const collectUtf8 = (
  stream: Stream.Stream<Uint8Array, PlatformError>
): Effect.Effect<string, PlatformError> =>
  stream.pipe(Stream.decodeText(), Stream.mkString);

const toWorkerError = (
  cause: unknown
): SandboxWorkerError | AdwWorkerProtocolError => {
  if (cause instanceof AdwWorkerProtocolError) {
    return cause;
  }
  if (cause instanceof SandboxWorkerError) {
    return cause;
  }
  if (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    (cause as { _tag: string })._tag ===
      AdwWorkerErrorTag.AdwWorkerProtocolError
  ) {
    return cause as AdwWorkerProtocolError;
  }
  return new SandboxWorkerError({
    message: "Failed while reading ADW worker protocol stdout",
    cause,
  });
};

/**
 * Spawn one ADW worker, write the request to stdin, decode newline frames from
 * stdout, and map interrupt to bounded SIGTERM → SIGKILL.
 */
export const runHostWorkerProcess = (
  options: RunHostWorkerOptions
): Effect.Effect<
  AdwWorkerTerminalOutcome,
  SandboxWorkerError | AdwWorkerProtocolError
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(
        options.launch.command,
        [...options.launch.args],
        {
          cwd: options.cwd,
          env: options.env ? { ...options.env } : undefined,
          extendEnv: options.env !== undefined,
          stdin: "pipe",
        }
      ).pipe(
        Effect.mapError(
          (cause) =>
            new SandboxWorkerError({
              message: "Failed to spawn ADW worker process",
              cause,
            })
        )
      );
      options.onSpawn?.(handle);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          options.onSettle?.(handle);
        })
      );

      const requestBytes = textEncoder.encode(
        encodeWorkerRequest(options.request)
      );
      yield* Stream.run(Stream.succeed(requestBytes), handle.stdin).pipe(
        Effect.mapError(
          (cause) =>
            new SandboxWorkerError({
              message: "Failed to write ADW worker request to stdin",
              cause,
            })
        )
      );

      let terminal: AdwWorkerTerminalOutcome | undefined;
      let sawTerminal = false;

      const consumeStdout = handle.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.mapEffect((line) =>
          Effect.gen(function* () {
            if (line.trim().length === 0) {
              return;
            }
            const frame = yield* decodeWorkerFrame(line);
            if (frame.kind === AdwWorkerFrameKind.Progress) {
              if (sawTerminal) {
                return yield* new SandboxWorkerError({
                  message: "Progress frame after terminal worker outcome",
                });
              }
              yield* options.onProgress(frame.event);
              return;
            }
            if (sawTerminal) {
              return yield* new SandboxWorkerError({
                message: "Duplicate terminal worker frame",
              });
            }
            sawTerminal = true;
            terminal = frame.outcome;
          })
        ),
        Stream.runDrain
      );

      const stderrFiber = yield* Effect.forkChild(
        collectUtf8(handle.stderr).pipe(Effect.catch(() => Effect.succeed("")))
      );

      const exitFiber = yield* Effect.forkChild(
        handle.exitCode.pipe(
          Effect.mapError(
            (cause) =>
              new SandboxWorkerError({
                message: "Failed waiting for ADW worker exit",
                cause,
              })
          )
        )
      );

      yield* consumeStdout.pipe(
        Effect.mapError(toWorkerError),
        Effect.onInterrupt(() =>
          Effect.gen(function* () {
            yield* handle
              .kill({ killSignal: "SIGTERM" })
              .pipe(Effect.catch(() => Effect.void));
            yield* handle.exitCode.pipe(
              Effect.asVoid,
              Effect.timeout(options.terminateGrace ?? "5 seconds"),
              Effect.catchTag("TimeoutError", () =>
                Effect.gen(function* () {
                  yield* handle
                    .kill({ killSignal: "SIGKILL" })
                    .pipe(Effect.catch(() => Effect.void));
                  yield* handle.exitCode.pipe(
                    Effect.asVoid,
                    Effect.timeout("2 seconds"),
                    Effect.catchTag("TimeoutError", () => Effect.void)
                  );
                })
              ),
              Effect.catch(() => Effect.void)
            );
          })
        )
      );

      const exitCode = Number(yield* Fiber.join(exitFiber));
      const stderr = redactWorkerDiagnostics(yield* Fiber.join(stderrFiber));

      if (!terminal) {
        return yield* new SandboxWorkerError({
          message:
            stderr.length > 0
              ? `ADW worker exited without terminal frame (code ${exitCode}): ${stderr}`
              : `ADW worker exited without terminal frame (code ${exitCode})`,
        });
      }

      if (terminal.kind === AdwWorkerTerminalKind.Completed && exitCode !== 0) {
        return yield* new SandboxWorkerError({
          message: `ADW worker reported completed but exited with code ${exitCode}`,
        });
      }

      return terminal;
    })
  ).pipe(Effect.provide(NodeChildProcessLive));
