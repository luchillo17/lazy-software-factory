import { assert, describe, it } from "@effect/vitest";
import type { Sandbox } from "@lazy-software-factory/runtime";
import { Effect, Layer, Ref } from "effect";
import { GitHost, GitHostError } from "./git-host.ts";
import { WorkspaceProvision } from "./workspace-provision.ts";

type ExecCall = {
  readonly command: string;
  readonly args: readonly string[];
};

const recordingSandbox = (
  calls: Ref.Ref<ExecCall[]>,
  resolve: (
    command: string,
    args: readonly string[]
  ) => {
    readonly exitCode: number;
    readonly stdout?: string;
    readonly stderr?: string;
  }
): Sandbox => ({
  id: "sandbox-1",
  cwd: "/tmp/sandbox-1",
  exec: (command, args = []) =>
    Effect.gen(function* () {
      yield* Ref.update(calls, (c) => [...c, { command, args: [...args] }]);
      const result = resolve(command, args);
      return {
        exitCode: result.exitCode,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    }),
  destroy: () => Effect.void,
});

const unusedGitHost = Layer.succeed(
  GitHost,
  GitHost.of({
    commitWorkingTree: () => Effect.void,
    clone: () => Effect.die("clone must not run when .git present"),
    push: () => Effect.die("unused"),
    openPullRequest: () => Effect.die("unused"),
  })
);

const hostLayer = WorkspaceProvision.Host.pipe(Layer.provide(unusedGitHost));

describe("WorkspaceProvision.Host", () => {
  it.effect(
    "reuses .git worktree, checks out ticket branch, runs frozen pnpm install",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make<ExecCall[]>([]);
        const sandbox = recordingSandbox(calls, (command, args) => {
          if (command === "git" && args[0] === "rev-parse") {
            return { exitCode: 0, stdout: ".git\n" };
          }
          if (command === "git" && args[0] === "checkout") {
            return { exitCode: 0 };
          }
          if (command === "test" && args[0] === "-f") {
            return {
              exitCode: args[1] === "pnpm-lock.yaml" ? 0 : 1,
            };
          }
          if (command === "pnpm") {
            return { exitCode: 0 };
          }
          return {
            exitCode: 1,
            stderr: `unexpected: ${command} ${args.join(" ")}`,
          };
        });

        yield* Effect.gen(function* () {
          const provisioner = yield* WorkspaceProvision;
          yield* provisioner.provision({
            sandbox,
            ticketId: "TICKET-42",
          });
        }).pipe(Effect.provide(hostLayer));

        const observed = yield* Ref.get(calls);
        assert.deepStrictEqual(
          observed.map((c) => [c.command, ...c.args]),
          [
            ["git", "rev-parse", "--git-dir"],
            ["git", "checkout", "-B", "adw/TICKET-42"],
            ["test", "-f", "pnpm-lock.yaml"],
            ["pnpm", "install", "--frozen-lockfile"],
          ]
        );
      })
  );

  it.effect("skips install when no lockfile is present", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ExecCall[]>([]);
      const sandbox = recordingSandbox(calls, (command, args) => {
        if (command === "git") {
          return { exitCode: 0, stdout: ".git\n" };
        }
        if (command === "test") {
          return { exitCode: 1 };
        }
        return { exitCode: 1, stderr: `unexpected: ${command}` };
      });

      yield* Effect.gen(function* () {
        const provisioner = yield* WorkspaceProvision;
        yield* provisioner.provision({
          sandbox,
          ticketId: "T-1",
        });
      }).pipe(Effect.provide(hostLayer));

      const observed = yield* Ref.get(calls);
      assert.isFalse(observed.some((c) => c.command === "pnpm"));
      assert.isTrue(
        observed.some(
          (c) =>
            c.command === "git" &&
            c.args[0] === "checkout" &&
            c.args.includes("adw/T-1")
        )
      );
    })
  );

  it.effect("install failure yields ProvisionError", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ExecCall[]>([]);
      const sandbox = recordingSandbox(calls, (command, args) => {
        if (command === "git") {
          return { exitCode: 0, stdout: ".git\n" };
        }
        if (command === "test") {
          return { exitCode: args[1] === "pnpm-lock.yaml" ? 0 : 1 };
        }
        if (command === "pnpm") {
          return { exitCode: 1, stderr: "ERR_PNPM_OUTDATED_LOCKFILE" };
        }
        return { exitCode: 1, stderr: `unexpected: ${command}` };
      });

      const result = yield* Effect.gen(function* () {
        const provisioner = yield* WorkspaceProvision;
        return yield* provisioner
          .provision({ sandbox, ticketId: "T-1" })
          .pipe(Effect.exit);
      }).pipe(Effect.provide(hostLayer));

      assert.strictEqual(result._tag, "Failure");
      assert.isTrue((yield* Ref.get(calls)).some((c) => c.command === "pnpm"));
    })
  );

  it.effect("empty worktree clones via GitHost then branch + install", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ExecCall[]>([]);
      const clones = yield* Ref.make<
        Array<{
          readonly repoUrl: string;
          readonly destination: string;
          readonly env?: Readonly<Record<string, string>>;
        }>
      >([]);
      let hasGit = false;

      const sandbox = recordingSandbox(calls, (command, args) => {
        if (command === "git" && args[0] === "rev-parse") {
          return {
            exitCode: hasGit ? 0 : 128,
            stdout: hasGit ? ".git\n" : "",
            stderr: hasGit ? "" : "not a git repository",
          };
        }
        if (command === "git" && args[0] === "checkout") {
          return { exitCode: 0 };
        }
        if (command === "test") {
          return { exitCode: args[1] === "pnpm-lock.yaml" ? 0 : 1 };
        }
        if (command === "pnpm") {
          return { exitCode: 0 };
        }
        return { exitCode: 1, stderr: `unexpected: ${command}` };
      });

      const gitLayer = Layer.succeed(
        GitHost,
        GitHost.of({
          commitWorkingTree: () => Effect.void,
          clone: (options) =>
            Effect.gen(function* () {
              yield* Ref.update(clones, (c) => [...c, options]);
              hasGit = true;
            }),
          push: () => Effect.die("unused"),
          openPullRequest: () => Effect.die("unused"),
        })
      );

      yield* Effect.gen(function* () {
        const provisioner = yield* WorkspaceProvision;
        yield* provisioner.provision({
          sandbox,
          ticketId: "T-9",
          repoUrl: "https://example.test/repo.git",
          env: { GH_TOKEN: "secret" },
        });
      }).pipe(
        Effect.provide(WorkspaceProvision.Host.pipe(Layer.provide(gitLayer)))
      );

      const cloneCalls = yield* Ref.get(clones);
      assert.deepStrictEqual(cloneCalls, [
        {
          repoUrl: "https://example.test/repo.git",
          destination: "/tmp/sandbox-1",
          env: { GH_TOKEN: "secret" },
        },
      ]);

      const observed = yield* Ref.get(calls);
      assert.deepStrictEqual(
        observed.map((c) => [c.command, ...c.args]),
        [
          ["git", "rev-parse", "--git-dir"],
          ["git", "checkout", "-B", "adw/T-9"],
          ["test", "-f", "pnpm-lock.yaml"],
          ["pnpm", "install", "--frozen-lockfile"],
        ]
      );
    })
  );

  it.effect("clone failure yields ProvisionError", () =>
    Effect.gen(function* () {
      const sandbox = recordingSandbox(
        yield* Ref.make<ExecCall[]>([]),
        (command) => {
          if (command === "git") {
            return { exitCode: 128, stderr: "not a git repository" };
          }
          return { exitCode: 1 };
        }
      );

      const gitLayer = Layer.succeed(
        GitHost,
        GitHost.of({
          commitWorkingTree: () => Effect.void,
          clone: () =>
            Effect.fail(new GitHostError({ message: "auth failed" })),
          push: () => Effect.die("unused"),
          openPullRequest: () => Effect.die("unused"),
        })
      );

      const result = yield* Effect.gen(function* () {
        const provisioner = yield* WorkspaceProvision;
        return yield* provisioner
          .provision({
            sandbox,
            ticketId: "T-1",
            repoUrl: "https://example.test/repo.git",
          })
          .pipe(Effect.exit);
      }).pipe(
        Effect.provide(WorkspaceProvision.Host.pipe(Layer.provide(gitLayer)))
      );

      assert.strictEqual(result._tag, "Failure");
    })
  );

  it.effect("missing .git without repoUrl fails without clone", () =>
    Effect.gen(function* () {
      const clones = yield* Ref.make(0);
      const sandbox = recordingSandbox(
        yield* Ref.make<ExecCall[]>([]),
        (command) => {
          if (command === "git") {
            return { exitCode: 128, stderr: "not a git repository" };
          }
          return { exitCode: 1 };
        }
      );

      const gitLayer = Layer.succeed(
        GitHost,
        GitHost.of({
          commitWorkingTree: () => Effect.void,
          clone: () =>
            Effect.gen(function* () {
              yield* Ref.update(clones, (n) => n + 1);
            }),
          push: () => Effect.die("unused"),
          openPullRequest: () => Effect.die("unused"),
        })
      );

      const result = yield* Effect.gen(function* () {
        const provisioner = yield* WorkspaceProvision;
        return yield* provisioner
          .provision({ sandbox, ticketId: "T-1" })
          .pipe(Effect.exit);
      }).pipe(
        Effect.provide(WorkspaceProvision.Host.pipe(Layer.provide(gitLayer)))
      );

      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(yield* Ref.get(clones), 0);
    })
  );
});
