import { spawn } from "node:child_process";
import { Effect } from "effect";
import type { GhRunResult } from "./gh-runner.ts";
import { GitHostError } from "./git-host.ts";

/** Spawn `gh`/`git`, capture utf8 streams, kill on AbortSignal. */
export const runProcess = (options: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}): Effect.Effect<GhRunResult, GitHostError> =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<GhRunResult>((resolve, reject) => {
        const child = spawn(options.command, [...options.args], {
          cwd: options.cwd,
          env: options.env ? { ...process.env, ...options.env } : process.env,
          shell: false,
        });
        const onAbort = () => {
          if (!child.killed) {
            child.kill("SIGTERM");
          }
        };
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener("abort", onAbort, { once: true });
        }

        let stdout = "";
        let stderr = "";
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (c: string) => {
          stdout += c;
        });
        child.stderr?.on("data", (c: string) => {
          stderr += c;
        });
        child.on("error", (err) => {
          signal.removeEventListener("abort", onAbort);
          reject(err);
        });
        child.on("close", (code) => {
          signal.removeEventListener("abort", onAbort);
          resolve({ exitCode: code ?? 1, stdout, stderr });
        });
      }),
    catch: (cause) =>
      new GitHostError({
        message: `Failed to run ${options.command}`,
        cause,
      }),
  });

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
