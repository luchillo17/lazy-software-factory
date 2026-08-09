import {
  NodeChildProcessSpawner,
  NodeFileSystem,
  NodePath,
} from "@effect/platform-node";
import { Effect, Layer, Stream } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { ChildProcess } from "effect/unstable/process";
import type { GhRunResult } from "./gh-runner.ts";
import { GitHostError } from "./git-host.ts";

const NodeChildProcessLive = NodeChildProcessSpawner.layer.pipe(
  Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
);

const collectUtf8 = (
  stream: Stream.Stream<Uint8Array, PlatformError>
): Effect.Effect<string, PlatformError> =>
  stream.pipe(Stream.decodeText(), Stream.mkString);

/** Spawn `gh`/`git` via Effect ChildProcess; capture utf8 streams. */
export const runProcess = (options: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}): Effect.Effect<GhRunResult, GitHostError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(
        options.command,
        [...options.args],
        {
          cwd: options.cwd,
          env: options.env ? { ...options.env } : undefined,
          extendEnv: options.env !== undefined,
        }
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
      } satisfies GhRunResult;
    })
  ).pipe(
    Effect.provide(NodeChildProcessLive),
    Effect.mapError(
      (cause) =>
        new GitHostError({
          message: `Failed to run ${options.command}`,
          cause,
        })
    )
  );

export const requireZero = (
  result: GhRunResult,
  label: string
): Effect.Effect<GhRunResult, GitHostError> =>
  result.exitCode === 0
    ? Effect.succeed(result)
    : Effect.fail(
        new GitHostError({
          message: `${label} failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
        })
      );
