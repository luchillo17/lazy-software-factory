import { spawn } from "node:child_process";
import { Effect, Layer } from "effect";
import { GhRunner, type GhRunResult } from "./gh-runner.ts";
import { GitHost, GitHostError } from "./git-host.ts";

const runProcess = (options: {
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

/** Live process runner for `gh` / `git`. */
export const GhRunnerLive = Layer.succeed(
  GhRunner,
  GhRunner.of({
    run: ({ command, args, cwd, env }) =>
      runProcess({ command, args, cwd, env }),
  })
);

const requireZero = (
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

/** GitHub/`gh` adapter requiring {@link GhRunner}. */
export const GitHubGh = Layer.effect(
  GitHost,
  Effect.gen(function* () {
    const cli = yield* GhRunner;

    return GitHost.of({
      clone: ({ repoUrl, destination, env }) =>
        Effect.gen(function* () {
          const result = yield* cli.run({
            command: "gh",
            args: ["repo", "clone", repoUrl, destination],
            env,
          });
          yield* requireZero(result, "gh repo clone");
        }),

      push: ({ cwd, branch, env }) =>
        Effect.gen(function* () {
          const push = yield* cli.run({
            command: "git",
            args: ["push", "-u", "origin", branch],
            cwd,
            env,
          });
          yield* requireZero(push, "git push");
        }),

      openPullRequest: ({ cwd, branch, title, body, base, env }) =>
        Effect.gen(function* () {
          const args = [
            "pr",
            "create",
            "--head",
            branch,
            "--title",
            title,
            "--body",
            body ?? "",
          ];
          if (base) {
            args.push("--base", base);
          }
          const result = yield* cli.run({
            command: "gh",
            args,
            cwd,
            env,
          });
          yield* requireZero(result, "gh pr create");
          const url = result.stdout.trim().split("\n").filter(Boolean).at(-1);
          if (!url) {
            return yield* new GitHostError({
              message: "gh pr create succeeded but printed no URL",
            });
          }
          return { url };
        }),
    });
  })
);

/** GitHub via `gh` + `git` with live process runner. */
export const GitHubGhLive = GitHubGh.pipe(Layer.provide(GhRunnerLive));
