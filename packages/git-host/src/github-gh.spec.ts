import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";
import { GhRunner } from "./gh-runner.ts";
import { GitHost } from "./git-host.ts";
import { GitHubGh } from "./github-gh.ts";

describe("GitHubGh", () => {
  it.effect("clone / push / openPullRequest go through the CLI runner", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<
        Array<{ command: string; args: readonly string[] }>
      >([]);

      const fakeCli = Layer.succeed(
        GhRunner,
        GhRunner.of({
          run: ({ command, args }) =>
            Effect.gen(function* () {
              yield* Ref.update(calls, (cs) => [...cs, { command, args }]);
              if (
                command === "gh" &&
                args[0] === "pr" &&
                args[1] === "create"
              ) {
                return {
                  exitCode: 0,
                  stdout: "Creating pull request…\n",
                  stderr: "",
                };
              }
              if (command === "gh" && args[0] === "pr" && args[1] === "view") {
                return {
                  exitCode: 0,
                  stdout: "https://github.com/example/repo/pull/1\n",
                  stderr: "",
                };
              }
              return { exitCode: 0, stdout: "", stderr: "" };
            }),
        })
      );

      const host = yield* GitHost.pipe(
        Effect.provide(GitHubGh.pipe(Layer.provide(fakeCli)))
      );

      yield* host.clone({
        repoUrl: "luchillo17/lazy-software-factory",
        destination: "/tmp/repo",
      });
      yield* host.push({ cwd: "/tmp/repo", branch: "adw/T-1" });
      const pr = yield* host.openPullRequest({
        cwd: "/tmp/repo",
        branch: "adw/T-1",
        title: "ADW: T-1",
      });

      assert.strictEqual(pr.url, "https://github.com/example/repo/pull/1");

      const seen = yield* Ref.get(calls);
      assert.deepStrictEqual(seen[0], {
        command: "gh",
        args: [
          "repo",
          "clone",
          "luchillo17/lazy-software-factory",
          "/tmp/repo",
        ],
      });
      assert.deepStrictEqual(seen[1], {
        command: "git",
        args: ["push", "-u", "origin", "adw/T-1"],
      });
      assert.strictEqual(seen[2]?.command, "gh");
      assert.deepStrictEqual(seen[2]?.args.slice(0, 2), ["pr", "create"]);
      assert.deepStrictEqual(seen[3], {
        command: "gh",
        args: ["pr", "view", "--json", "url", "--jq", ".url"],
      });
    })
  );

  it.effect("commitWorkingTree no-ops when porcelain is empty", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<
        Array<{ command: string; args: readonly string[] }>
      >([]);

      const fakeCli = Layer.succeed(
        GhRunner,
        GhRunner.of({
          run: ({ command, args }) =>
            Effect.gen(function* () {
              yield* Ref.update(calls, (cs) => [...cs, { command, args }]);
              return { exitCode: 0, stdout: "", stderr: "" };
            }),
        })
      );

      const host = yield* GitHost.pipe(
        Effect.provide(GitHubGh.pipe(Layer.provide(fakeCli)))
      );

      yield* host.commitWorkingTree({
        cwd: "/tmp/repo",
        message: "chore(adw): ship pending changes for T-1",
      });

      const seen = yield* Ref.get(calls);
      assert.deepStrictEqual(seen, [
        { command: "git", args: ["status", "--porcelain"] },
      ]);
    })
  );

  it.effect("commitWorkingTree adds and commits when dirty", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<
        Array<{ command: string; args: readonly string[] }>
      >([]);

      const fakeCli = Layer.succeed(
        GhRunner,
        GhRunner.of({
          run: ({ command, args }) =>
            Effect.gen(function* () {
              yield* Ref.update(calls, (cs) => [...cs, { command, args }]);
              if (
                command === "git" &&
                args[0] === "status" &&
                args[1] === "--porcelain"
              ) {
                return {
                  exitCode: 0,
                  stdout: " M packages/adw/src/run-minimal-adw.ts\n",
                  stderr: "",
                };
              }
              return { exitCode: 0, stdout: "", stderr: "" };
            }),
        })
      );

      const host = yield* GitHost.pipe(
        Effect.provide(GitHubGh.pipe(Layer.provide(fakeCli)))
      );

      yield* host.commitWorkingTree({
        cwd: "/tmp/repo",
        message: "chore(adw): ship pending changes for T-1",
      });

      const seen = yield* Ref.get(calls);
      assert.deepStrictEqual(seen, [
        { command: "git", args: ["status", "--porcelain"] },
        { command: "git", args: ["add", "-A"] },
        {
          command: "git",
          args: ["commit", "-m", "chore(adw): ship pending changes for T-1"],
        },
      ]);
    })
  );
});
