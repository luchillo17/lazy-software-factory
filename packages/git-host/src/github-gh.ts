import { Effect, Layer } from "effect";
import { GhRunner } from "./gh-runner.ts";
import { GitHost, GitHostError } from "./git-host.ts";
import { requireZero, runProcess } from "./run-process.ts";

/** Live process runner for `gh` / `git`. */
export const GhRunnerLive = Layer.succeed(
  GhRunner,
  GhRunner.of({
    run: ({ command, args, cwd, env }) =>
      runProcess({ command, args, cwd, env }),
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

      commitWorkingTree: ({ cwd, message, env }) =>
        Effect.gen(function* () {
          const status = yield* cli.run({
            command: "git",
            args: ["status", "--porcelain"],
            cwd,
            env,
          });
          yield* requireZero(status, "git status --porcelain");
          if (status.stdout.trim() === "") {
            return;
          }
          const add = yield* cli.run({
            command: "git",
            args: ["add", "-A"],
            cwd,
            env,
          });
          yield* requireZero(add, "git add -A");
          const commit = yield* cli.run({
            command: "git",
            args: ["commit", "-m", message],
            cwd,
            env,
          });
          yield* requireZero(commit, "git commit");
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
          const created = yield* cli.run({
            command: "gh",
            args,
            cwd,
            env,
          });
          yield* requireZero(created, "gh pr create");

          // `gh pr create` has no --json; resolve URL via structured view.
          const viewed = yield* cli.run({
            command: "gh",
            args: ["pr", "view", "--json", "url", "--jq", ".url"],
            cwd,
            env,
          });
          yield* requireZero(viewed, "gh pr view");
          const url = viewed.stdout.trim();
          if (!url) {
            return yield* new GitHostError({
              message: "gh pr view returned empty url",
            });
          }
          return { url };
        }),

      remoteBranchExists: ({ cwd, branch, remote = "origin", env }) =>
        Effect.gen(function* () {
          const listed = yield* cli.run({
            command: "git",
            args: ["ls-remote", "--heads", remote, branch],
            cwd,
            env,
          });
          yield* requireZero(listed, "git ls-remote");
          return listed.stdout.trim().length > 0;
        }),

      findOpenPullRequest: ({ cwd, head, env }) =>
        Effect.gen(function* () {
          const listed = yield* cli.run({
            command: "gh",
            args: [
              "pr",
              "list",
              "--head",
              head,
              "--state",
              "open",
              "--json",
              "url",
              "--jq",
              ".[0].url // empty",
            ],
            cwd,
            env,
          });
          yield* requireZero(listed, "gh pr list");
          const url = listed.stdout.trim();
          return url.length > 0 ? { url } : null;
        }),
    });
  })
);

/** GitHub via `gh` + `git` with live process runner. */
export const GitHubGhLive = GitHubGh.pipe(Layer.provide(GhRunnerLive));
