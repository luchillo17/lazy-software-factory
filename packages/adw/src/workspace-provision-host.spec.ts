import { assert, describe, it } from "@effect/vitest";
import type { Sandbox } from "@lazy-software-factory/runtime";
import { Effect, Layer, Ref } from "effect";
import { stubGitHost } from "./git-host-stub.ts";
import { GitHost, GitHostError } from "./git-host.ts";
import {
  ProvisionErrorTag,
  WorkspaceProvision,
} from "./workspace-provision.ts";

type ExecCall = {
  readonly command: string;
  readonly args: readonly string[];
};

type WorkspaceFixture = {
  readonly packageJson?: string;
  readonly files?: ReadonlySet<string>;
  readonly yarnLockHead?: string;
  readonly installExit?: (
    command: string,
    args: readonly string[]
  ) => {
    readonly exitCode: number;
    readonly stdout?: string;
    readonly stderr?: string;
  };
};

const recordingSandbox = (
  calls: Ref.Ref<ExecCall[]>,
  fixture: WorkspaceFixture = {}
): Sandbox => {
  const files = fixture.files ?? new Set<string>();
  return {
    id: "sandbox-1",
    cwd: "/tmp/sandbox-1",
    exec: ({ command, argv: args = [] }) =>
      Effect.gen(function* () {
        yield* Ref.update(calls, (c) => [...c, { command, args: [...args] }]);

        if (command === "git" && args[0] === "rev-parse") {
          return { exitCode: 0, stdout: ".git\n", stderr: "" };
        }
        if (command === "git" && args[0] === "checkout") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (command === "cat" && args[0] === "package.json") {
          if (fixture.packageJson === undefined) {
            return { exitCode: 1, stdout: "", stderr: "No such file" };
          }
          return { exitCode: 0, stdout: fixture.packageJson, stderr: "" };
        }
        if (command === "test" && args[0] === "-f") {
          return {
            exitCode: files.has(args[1] ?? "") ? 0 : 1,
            stdout: "",
            stderr: "",
          };
        }
        if (command === "head" && args.includes("yarn.lock")) {
          return {
            exitCode: files.has("yarn.lock") ? 0 : 1,
            stdout: fixture.yarnLockHead ?? "",
            stderr: "",
          };
        }
        if (
          command === "corepack" ||
          command === "npm" ||
          command === "pnpm" ||
          command === "yarn"
        ) {
          const custom = fixture.installExit?.(command, args);
          if (custom) {
            return {
              exitCode: custom.exitCode,
              stdout: custom.stdout ?? "",
              stderr: custom.stderr ?? "",
            };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        return {
          exitCode: 1,
          stdout: "",
          stderr: `unexpected: ${command} ${args.join(" ")}`,
        };
      }),
    destroy: () => Effect.void,
  };
};

const unusedGitHost = Layer.succeed(
  GitHost,
  stubGitHost({
    clone: () => Effect.die("clone must not run when .git present"),
  })
);

const hostLayer = WorkspaceProvision.Host.pipe(Layer.provide(unusedGitHost));

const provision = (sandbox: Sandbox, ticketId = "TICKET-42") =>
  Effect.gen(function* () {
    const provisioner = yield* WorkspaceProvision;
    return yield* provisioner.provision({ sandbox, ticketId });
  }).pipe(Effect.provide(hostLayer));

const observedCommands = (calls: readonly ExecCall[]) =>
  calls.map((c) => [c.command, ...c.args]);

describe("WorkspaceProvision.Host locked install", () => {
  it.effect("prefers packageManager metadata over a conflicting lockfile", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ExecCall[]>([]);
      const sandbox = recordingSandbox(calls, {
        packageJson: JSON.stringify({
          packageManager: "pnpm@9.15.0",
        }),
        files: new Set(["pnpm-lock.yaml", "yarn.lock"]),
      });

      yield* provision(sandbox);

      assert.deepStrictEqual(observedCommands(yield* Ref.get(calls)).slice(2), [
        ["cat", "package.json"],
        ["test", "-f", "pnpm-lock.yaml"],
        ["test", "-f", "package-lock.json"],
        ["test", "-f", "npm-shrinkwrap.json"],
        ["test", "-f", "yarn.lock"],
        ["test", "-f", "bun.lockb"],
        ["test", "-f", "bun.lock"],
        ["corepack", "enable"],
        ["corepack", "prepare", "pnpm@9.15.0", "--activate"],
        ["pnpm", "install", "--frozen-lockfile"],
      ]);
    })
  );

  it.effect("falls back to pnpm lockfile when packageManager is absent", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ExecCall[]>([]);
      const sandbox = recordingSandbox(calls, {
        packageJson: JSON.stringify({ name: "app" }),
        files: new Set(["pnpm-lock.yaml"]),
      });

      yield* provision(sandbox);

      const cmds = observedCommands(yield* Ref.get(calls));
      assert.isTrue(
        cmds.some(
          (c) =>
            c[0] === "pnpm" &&
            c[1] === "install" &&
            c[2] === "--frozen-lockfile"
        )
      );
      assert.isFalse(cmds.some((c) => c[0] === "corepack"));
    })
  );

  it.effect("falls back to npm ci when only package-lock.json is present", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ExecCall[]>([]);
      const sandbox = recordingSandbox(calls, {
        files: new Set(["package-lock.json"]),
      });

      yield* provision(sandbox);

      assert.deepStrictEqual(
        observedCommands(yield* Ref.get(calls)).filter((c) => c[0] === "npm"),
        [["npm", "ci"]]
      );
      assert.isFalse(
        (yield* Ref.get(calls)).some((c) => c.command === "corepack")
      );
    })
  );

  it.effect("fails for unknown packageManager names before install", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ExecCall[]>([]);
      const sandbox = recordingSandbox(calls, {
        packageJson: JSON.stringify({ packageManager: "deno@2.0.0" }),
        files: new Set(["package-lock.json"]),
      });

      const message = yield* provision(sandbox).pipe(
        Effect.map(() => null as string | null),
        Effect.catchTag(ProvisionErrorTag.ProvisionError, (e) =>
          Effect.succeed(e.message)
        )
      );
      assert.isTrue(
        message?.includes("Unsupported package manager deno") ?? false
      );
      assert.isFalse(
        (yield* Ref.get(calls)).some((c) =>
          ["npm", "pnpm", "yarn", "corepack"].includes(c.command)
        )
      );
    })
  );

  it.effect("runs npm ci for npm lockfile repositories", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ExecCall[]>([]);
      const sandbox = recordingSandbox(calls, {
        packageJson: JSON.stringify({ packageManager: "npm@10.9.0" }),
        files: new Set(["package-lock.json"]),
      });

      yield* provision(sandbox);

      const cmds = observedCommands(yield* Ref.get(calls));
      assert.deepStrictEqual(
        cmds.filter((c) => c[0] === "npm" || c[0] === "corepack"),
        [["npm", "ci"]]
      );
    })
  );

  it.effect(
    "activates declared pnpm via Corepack then frozen-lockfile install",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make<ExecCall[]>([]);
        const sandbox = recordingSandbox(calls, {
          packageJson: JSON.stringify({
            packageManager: "pnpm@9.15.0+sha512.deadbeef",
          }),
          files: new Set(["pnpm-lock.yaml"]),
        });

        yield* provision(sandbox);

        assert.deepStrictEqual(
          observedCommands(yield* Ref.get(calls)).filter(
            (c) => c[0] === "corepack" || c[0] === "pnpm"
          ),
          [
            ["corepack", "enable"],
            ["corepack", "prepare", "pnpm@9.15.0", "--activate"],
            ["pnpm", "install", "--frozen-lockfile"],
          ]
        );
      })
  );

  it.effect(
    "activates declared Yarn Berry via Corepack then immutable install",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make<ExecCall[]>([]);
        const sandbox = recordingSandbox(calls, {
          packageJson: JSON.stringify({ packageManager: "yarn@3.6.4" }),
          files: new Set(["yarn.lock"]),
          yarnLockHead: "# yarn lockfile v1\n__metadata:\n  version: 6\n",
        });

        yield* provision(sandbox);

        assert.deepStrictEqual(
          observedCommands(yield* Ref.get(calls)).filter(
            (c) => c[0] === "corepack" || c[0] === "yarn"
          ),
          [
            ["corepack", "enable"],
            ["corepack", "prepare", "yarn@3.6.4", "--activate"],
            ["yarn", "install", "--immutable"],
          ]
        );
      })
  );

  it.effect(
    "uses Yarn Classic frozen-lockfile when lockfile has no Berry metadata",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make<ExecCall[]>([]);
        const sandbox = recordingSandbox(calls, {
          files: new Set(["yarn.lock"]),
          yarnLockHead:
            '# yarn lockfile v1\n\nnoop@^1.0.0:\n  version "1.0.0"\n',
        });

        yield* provision(sandbox);

        assert.deepStrictEqual(
          observedCommands(yield* Ref.get(calls)).filter(
            (c) => c[0] === "yarn"
          ),
          [["yarn", "install", "--frozen-lockfile"]]
        );
      })
  );

  it.effect("skips install when no lockfile or packageManager is present", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ExecCall[]>([]);
      const sandbox = recordingSandbox(calls, {
        packageJson: JSON.stringify({ name: "app" }),
      });

      yield* provision(sandbox, "T-1");

      const observed = yield* Ref.get(calls);
      assert.isFalse(
        observed.some((c) =>
          ["npm", "pnpm", "yarn", "corepack"].includes(c.command)
        )
      );
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

  it.effect(
    "fails before install when lockfiles contradict without packageManager",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make<ExecCall[]>([]);
        const sandbox = recordingSandbox(calls, {
          files: new Set(["pnpm-lock.yaml", "package-lock.json"]),
        });

        const message = yield* provision(sandbox).pipe(
          Effect.map(() => null as string | null),
          Effect.catchTag(ProvisionErrorTag.ProvisionError, (e) =>
            Effect.succeed(e.message)
          )
        );

        assert.isTrue(message?.includes("Contradictory lockfiles") ?? false);
        assert.isFalse(
          (yield* Ref.get(calls)).some((c) =>
            ["npm", "pnpm", "yarn", "corepack"].includes(c.command)
          )
        );
      })
  );

  it.effect("fails when declared manager lockfile is missing", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ExecCall[]>([]);
      const sandbox = recordingSandbox(calls, {
        packageJson: JSON.stringify({ packageManager: "pnpm@9.0.0" }),
        files: new Set(["yarn.lock"]),
      });

      const message = yield* provision(sandbox).pipe(
        Effect.map(() => null as string | null),
        Effect.catchTag(ProvisionErrorTag.ProvisionError, (e) =>
          Effect.succeed(e.message)
        )
      );
      assert.isTrue(message?.includes("requires pnpm-lock.yaml") ?? false);
      assert.isFalse(
        (yield* Ref.get(calls)).some((c) =>
          ["npm", "pnpm", "yarn", "corepack"].includes(c.command)
        )
      );
    })
  );

  it.effect("fails for Bun as an unsupported default-runner capability", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ExecCall[]>([]);
      const sandbox = recordingSandbox(calls, {
        packageJson: JSON.stringify({ packageManager: "bun@1.1.0" }),
        files: new Set(["bun.lockb"]),
      });

      const message = yield* provision(sandbox).pipe(
        Effect.map(() => null as string | null),
        Effect.catchTag(ProvisionErrorTag.ProvisionError, (e) =>
          Effect.succeed(e.message)
        )
      );
      assert.isTrue(
        message?.includes("Unsupported package manager bun") ?? false
      );
      assert.isFalse((yield* Ref.get(calls)).some((c) => c.command === "bun"));
    })
  );

  it.effect(
    "failed locked install yields redacted bounded ProvisionError detail",
    () =>
      Effect.gen(function* () {
        const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
        const longTail = "x".repeat(3_000);
        const calls = yield* Ref.make<ExecCall[]>([]);
        const sandbox = recordingSandbox(calls, {
          packageJson: JSON.stringify({ packageManager: "npm@10.0.0" }),
          files: new Set(["package-lock.json"]),
          installExit: (command) => {
            if (command === "npm") {
              return {
                exitCode: 1,
                stderr: `ERR npm ci failed token=${secret} ${longTail}`,
              };
            }
            return { exitCode: 0 };
          },
        });

        const message = yield* provision(sandbox).pipe(
          Effect.map(() => null as string | null),
          Effect.catchTag(ProvisionErrorTag.ProvisionError, (e) =>
            Effect.succeed(e.message)
          )
        );
        assert.isNotNull(message);
        assert.isFalse(message!.includes(secret));
        assert.isTrue(message!.includes("[REDACTED]"));
        assert.isTrue(message!.includes("npm ci failed"));
        assert.isTrue(message!.length < 2_500);
      })
  );
});

describe("WorkspaceProvision.Host", () => {
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

      const files = new Set(["pnpm-lock.yaml"]);
      const sandbox: Sandbox = {
        id: "sandbox-1",
        cwd: "/tmp/sandbox-1",
        exec: ({ command, argv: args = [] }) =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (c) => [
              ...c,
              { command, args: [...args] },
            ]);
            if (command === "git" && args[0] === "rev-parse") {
              return {
                exitCode: hasGit ? 0 : 128,
                stdout: hasGit ? ".git\n" : "",
                stderr: hasGit ? "" : "not a git repository",
              };
            }
            if (command === "git" && args[0] === "checkout") {
              return { exitCode: 0, stdout: "", stderr: "" };
            }
            if (command === "cat" && args[0] === "package.json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ packageManager: "pnpm@9.0.0" }),
                stderr: "",
              };
            }
            if (command === "test" && args[0] === "-f") {
              return {
                exitCode: files.has(args[1] ?? "") ? 0 : 1,
                stdout: "",
                stderr: "",
              };
            }
            if (command === "corepack" || command === "pnpm") {
              return { exitCode: 0, stdout: "", stderr: "" };
            }
            return {
              exitCode: 1,
              stdout: "",
              stderr: `unexpected: ${command}`,
            };
          }),
        destroy: () => Effect.void,
      };

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
          remoteBranchExists: () => Effect.succeed(false),
          findOpenPullRequest: () => Effect.succeed(null),
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

      const cmds = observedCommands(yield* Ref.get(calls));
      assert.deepStrictEqual(cmds.slice(0, 2), [
        ["git", "rev-parse", "--git-dir"],
        ["git", "checkout", "-B", "adw/T-9"],
      ]);
      assert.isTrue(
        cmds.some(
          (c) =>
            c[0] === "pnpm" &&
            c[1] === "install" &&
            c[2] === "--frozen-lockfile"
        )
      );
    })
  );

  it.effect("clone failure yields ProvisionError", () =>
    Effect.gen(function* () {
      const sandbox = recordingSandbox(yield* Ref.make<ExecCall[]>([]), {});
      // Force missing git by custom sandbox:
      const empty: Sandbox = {
        ...sandbox,
        exec: ({ command, argv: args = [] }) => {
          if (command === "git") {
            return Effect.succeed({
              exitCode: 128,
              stdout: "",
              stderr: "not a git repository",
            });
          }
          return sandbox.exec({ command, argv: args });
        },
      };

      const gitLayer = Layer.succeed(
        GitHost,
        GitHost.of({
          commitWorkingTree: () => Effect.void,
          clone: () =>
            Effect.fail(new GitHostError({ message: "auth failed" })),
          push: () => Effect.die("unused"),
          openPullRequest: () => Effect.die("unused"),
          remoteBranchExists: () => Effect.succeed(false),
          findOpenPullRequest: () => Effect.succeed(null),
        })
      );

      const result = yield* Effect.gen(function* () {
        const provisioner = yield* WorkspaceProvision;
        return yield* provisioner
          .provision({
            sandbox: empty,
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
      const empty: Sandbox = {
        id: "sandbox-1",
        cwd: "/tmp/sandbox-1",
        exec: ({ command }) =>
          Effect.succeed(
            command === "git"
              ? {
                  exitCode: 128,
                  stdout: "",
                  stderr: "not a git repository",
                }
              : { exitCode: 1, stdout: "", stderr: "unexpected" }
          ),
        destroy: () => Effect.void,
      };

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
          remoteBranchExists: () => Effect.succeed(false),
          findOpenPullRequest: () => Effect.succeed(null),
        })
      );

      const result = yield* Effect.gen(function* () {
        const provisioner = yield* WorkspaceProvision;
        return yield* provisioner
          .provision({ sandbox: empty, ticketId: "T-1" })
          .pipe(Effect.exit);
      }).pipe(
        Effect.provide(WorkspaceProvision.Host.pipe(Layer.provide(gitLayer)))
      );

      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(yield* Ref.get(clones), 0);
    })
  );
});
