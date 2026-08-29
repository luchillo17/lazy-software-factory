import {
  NodeChildProcessSpawner,
  NodeFileSystem,
  NodePath,
} from "@effect/platform-node";
import { Effect, Layer, Stream } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { ChildProcess } from "effect/unstable/process";
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner";

/** Result of a captured subprocess (stdout/stderr as utf8 strings). */
export interface CapturedProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Node ChildProcessSpawner + FS/Path deps. */
export const NodeChildProcessLive = NodeChildProcessSpawner.layer.pipe(
  Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
);

const collectUtf8 = (
  stream: Stream.Stream<Uint8Array, PlatformError>
): Effect.Effect<string, PlatformError> =>
  stream.pipe(Stream.decodeText(), Stream.mkString);

/**
 * Spawn via Effect `ChildProcess`, capture utf8 stdout/stderr, respect Scope.
 * Optional hooks let Host sandbox track handles for destroy.
 */
export const runCapturedProcess = (options: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly stdin?: string | Uint8Array;
  readonly timeoutMs?: number;
  /** When true (default if `env` set), merge `env` onto `process.env`. */
  readonly extendEnv?: boolean;
  readonly onSpawn?: (handle: ChildProcessHandle) => void;
  readonly onSettle?: (handle: ChildProcessHandle) => void;
}) => {
  const stdin =
    typeof options.stdin === "string"
      ? new TextEncoder().encode(options.stdin)
      : options.stdin;
  const run = Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(
        options.command,
        [...options.args],
        {
          cwd: options.cwd,
          env: options.env ? { ...options.env } : undefined,
          extendEnv: options.extendEnv ?? options.env !== undefined,
          stdin: stdin === undefined ? "ignore" : Stream.succeed(stdin),
        }
      );
      options.onSpawn?.(handle);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          options.onSettle?.(handle);
        })
      );

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          collectUtf8(handle.stdout),
          collectUtf8(handle.stderr),
          handle.exitCode,
        ],
        { concurrency: "unbounded" }
      );

      return {
        exitCode: Number(exitCode),
        stdout,
        stderr,
      } satisfies CapturedProcessResult;
    })
  ).pipe(Effect.provide(NodeChildProcessLive));

  return options.timeoutMs === undefined
    ? run
    : run.pipe(Effect.timeout(`${options.timeoutMs} millis`));
};
