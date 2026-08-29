import { assert, describe, it } from "@effect/vitest";
import {
  AgentError,
  BuildAgentProvider,
  ReviewAgentProvider,
  SandboxProvider,
  type Sandbox,
} from "@lazy-software-factory/runtime";
import { Effect, Layer, Ref } from "effect";
import {
  AdwBuildAttemptCap,
  AdwReviewAttemptCap,
  AdwSchemaResumeCap,
} from "./attempt-caps.ts";
import { AdwStatus } from "./enums.ts";
import { GitHost } from "./git-host.ts";
import { runMinimalAdwGraph } from "./run-minimal-adw-graph.ts";
import { submitReviewPassViaTools } from "./review-tool-test-helpers.ts";
import { AdwTestCommands } from "./test-commands.ts";
import { withEmptyPendingDeltaGit } from "./empty-pending-delta-git-test-helpers.ts";
import { ProvisionError, WorkspaceProvision } from "./workspace-provision.ts";
import { monorepoRoot } from "./monorepo-root.ts";

describe("runMinimalAdwGraph happy path", () => {
  it.effect("provision → Build → Test → Review → Ship yields shipped", () =>
    Effect.gen(function* () {
      const steps = yield* Ref.make<string[]>([]);
      const pushThenPr = yield* Ref.make<string[]>([]);
      const record = (step: string) => Ref.update(steps, (s) => [...s, step]);

      const fakeSandboxLayer = Layer.succeed(
        SandboxProvider,
        SandboxProvider.of({
          acquire: () => Effect.die("acquire unused in graph test"),
          create: () =>
            Effect.gen(function* () {
              yield* record("sandbox");
              const box: Sandbox = {
                id: "sandbox-1",
                cwd: monorepoRoot,
                exec: withEmptyPendingDeltaGit(({ command, argv: args = [] }) =>
                  Effect.gen(function* () {
                    if (command === "git" && args[0] === "rev-parse") {
                      yield* record("provision-git");
                      return { exitCode: 0, stdout: ".git\n", stderr: "" };
                    }
                    if (command === "git" && args[0] === "checkout") {
                      yield* record("provision-branch");
                      assert.deepStrictEqual(
                        [...args],
                        ["checkout", "-B", "adw/TICKET-1"]
                      );
                      return { exitCode: 0, stdout: "", stderr: "" };
                    }
                    if (command === "cat" && args[0] === "package.json") {
                      return {
                        exitCode: 0,
                        stdout: JSON.stringify({
                          packageManager: "pnpm@9.0.0",
                        }),
                        stderr: "",
                      };
                    }
                    if (command === "test" && args[0] === "-f") {
                      return {
                        exitCode: args[1] === "pnpm-lock.yaml" ? 0 : 1,
                        stdout: "",
                        stderr: "",
                      };
                    }
                    if (command === "corepack") {
                      return { exitCode: 0, stdout: "", stderr: "" };
                    }
                    if (command === "pnpm") {
                      yield* record("provision-install");
                      assert.deepStrictEqual(
                        [...args],
                        ["install", "--frozen-lockfile"]
                      );
                      return { exitCode: 0, stdout: "", stderr: "" };
                    }
                    yield* record("test");
                    assert.strictEqual(command, "node");
                    assert.deepStrictEqual(
                      [...args],
                      ["-e", "process.exit(0)"]
                    );
                    return { exitCode: 0, stdout: "", stderr: "" };
                  })
                ),
                destroy: () => Effect.void,
              };
              return box;
            }),
        })
      );

      const buildLayer = Layer.succeed(
        BuildAgentProvider,
        BuildAgentProvider.of({
          run: (options) =>
            Effect.gen(function* () {
              yield* record("build");
              assert.isDefined(options.sandbox);
              assert.isTrue(options.prompt.includes("/implement"));
              assert.isTrue(options.prompt.includes("implement the thing"));
              return { sessionId: "build-session-1" };
            }),
          resume: () => Effect.die("Build resume must not run on happy path"),
        })
      );

      const reviewLayer = Layer.succeed(
        ReviewAgentProvider,
        ReviewAgentProvider.of({
          run: (options) =>
            Effect.gen(function* () {
              yield* record("review");
              assert.isDefined(options.sandbox);
              assert.isTrue(options.prompt.includes("/adw-review"));
              assert.isTrue(options.prompt.includes("submit_review_pass"));
              assert.isTrue(options.prompt.includes("ADW run `TICKET-1`"));
              assert.isTrue(options.prompt.includes("## Work"));
              assert.isTrue(options.prompt.includes("implement the thing"));
              yield* submitReviewPassViaTools(options);
              return { sessionId: "review-session-1" };
            }),
          resume: () => Effect.die("Review resume must not run on happy path"),
        })
      );

      const gitLayer = Layer.succeed(
        GitHost,
        GitHost.of({
          commitWorkingTree: () => Effect.void,
          clone: () => Effect.void,
          push: () =>
            Effect.gen(function* () {
              yield* record("ship-push");
              yield* Ref.update(pushThenPr, (s) => [...s, "push"]);
            }),
          openPullRequest: () =>
            Effect.gen(function* () {
              yield* record("ship-pr");
              yield* Ref.update(pushThenPr, (s) => [...s, "pr"]);
              return { url: "https://example.test/pr/1" };
            }),
          remoteBranchExists: () => Effect.succeed(false),
          findOpenPullRequest: () => Effect.succeed(null),
        })
      );

      const testCommandsLayer = Layer.succeed(
        AdwTestCommands,
        AdwTestCommands.of({
          resolve: () => [{ command: "node", args: ["-e", "process.exit(0)"] }],
        })
      );

      const result = yield* runMinimalAdwGraph({
        ticketId: "TICKET-1",
        prompt: "implement the thing",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            fakeSandboxLayer,
            WorkspaceProvision.Host.pipe(Layer.provide(gitLayer)),
            buildLayer,
            reviewLayer,
            gitLayer,
            testCommandsLayer,
            AdwBuildAttemptCap.Default,
            AdwReviewAttemptCap.Default,
            AdwSchemaResumeCap.Default
          )
        )
      );

      assert.strictEqual(result.status, AdwStatus.Shipped);
      assert.strictEqual(result.prUrl, "https://example.test/pr/1");
      assert.strictEqual(result.sandboxId, "sandbox-1");
      assert.strictEqual(result.buildSessionId, "build-session-1");
      assert.strictEqual(result.reviewSessionId, "review-session-1");

      const observed = yield* Ref.get(steps);
      assert.deepStrictEqual(observed, [
        "sandbox",
        "provision-git",
        "provision-branch",
        "provision-install",
        "build",
        "test",
        "review",
        "ship-push",
        "ship-pr",
      ]);

      const shipOrder = yield* Ref.get(pushThenPr);
      assert.deepStrictEqual(shipOrder, ["push", "pr"]);
    })
  );

  it.effect(
    "agent infrastructure failure escapes the completed ADW result",
    () =>
      Effect.gen(function* () {
        const layers = Layer.mergeAll(
          Layer.succeed(
            SandboxProvider,
            SandboxProvider.of({
              acquire: () => Effect.die("acquire unused in graph test"),
              create: () =>
                Effect.succeed({
                  id: "sandbox-1",
                  cwd: monorepoRoot,
                  exec: () =>
                    Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
                  destroy: () => Effect.void,
                } satisfies Sandbox),
            })
          ),
          Layer.succeed(
            WorkspaceProvision,
            WorkspaceProvision.of({ provision: () => Effect.void })
          ),
          Layer.succeed(
            BuildAgentProvider,
            BuildAgentProvider.of({
              run: () =>
                Effect.fail(
                  new AgentError({ message: "agent transport down" })
                ),
              resume: () => Effect.die("unused"),
            })
          ),
          ReviewAgentProvider.NotImplemented,
          Layer.succeed(
            GitHost,
            GitHost.of({
              commitWorkingTree: () => Effect.void,
              clone: () => Effect.void,
              push: () => Effect.void,
              openPullRequest: () => Effect.die("unused"),
              remoteBranchExists: () => Effect.succeed(false),
              findOpenPullRequest: () => Effect.succeed(null),
            })
          ),
          Layer.succeed(
            AdwTestCommands,
            AdwTestCommands.of({ resolve: () => [{ command: "node" }] })
          ),
          AdwBuildAttemptCap.Default,
          AdwReviewAttemptCap.Default,
          AdwSchemaResumeCap.Default
        );

        const exit = yield* runMinimalAdwGraph({
          ticketId: "TICKET-INFRA",
          prompt: "work",
        }).pipe(Effect.provide(layers), Effect.exit);

        assert.strictEqual(exit._tag, "Failure");
        if (exit._tag === "Failure") {
          assert.include(String(exit.cause), "agent transport down");
        }
      })
  );

  it.effect("sandbox create uses input.cwd when provided", () =>
    Effect.gen(function* () {
      const createCwds = yield* Ref.make<string[]>([]);

      const layers = Layer.mergeAll(
        Layer.succeed(
          SandboxProvider,
          SandboxProvider.of({
            acquire: () => Effect.die("acquire unused in graph test"),
            create: (options) =>
              Effect.gen(function* () {
                yield* Ref.update(createCwds, (cs) => [
                  ...cs,
                  options?.cwd ?? "(missing)",
                ]);
                return {
                  id: "sandbox-cwd",
                  cwd: options?.cwd ?? monorepoRoot,
                  exec: () =>
                    Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
                  destroy: () => Effect.void,
                } satisfies Sandbox;
              }),
          })
        ),
        Layer.succeed(
          WorkspaceProvision,
          WorkspaceProvision.of({
            provision: () =>
              Effect.fail(new ProvisionError({ message: "stop after create" })),
          })
        ),
        Layer.succeed(
          BuildAgentProvider,
          BuildAgentProvider.of({
            run: () => Effect.die("unused"),
            resume: () => Effect.die("unused"),
          })
        ),
        Layer.succeed(
          ReviewAgentProvider,
          ReviewAgentProvider.of({
            run: () => Effect.die("unused"),
            resume: () => Effect.die("unused"),
          })
        ),
        Layer.succeed(
          GitHost,
          GitHost.of({
            commitWorkingTree: () => Effect.void,
            clone: () => Effect.void,
            push: () => Effect.void,
            openPullRequest: () =>
              Effect.succeed({ url: "https://example.test/pr/1" }),
            remoteBranchExists: () => Effect.succeed(false),
            findOpenPullRequest: () => Effect.succeed(null),
          })
        ),
        Layer.succeed(
          AdwTestCommands,
          AdwTestCommands.of({
            resolve: () => [
              { command: "node", args: ["-e", "process.exit(0)"] },
            ],
          })
        ),
        AdwBuildAttemptCap.Default,
        AdwReviewAttemptCap.Default,
        AdwSchemaResumeCap.Default
      );

      const result = yield* runMinimalAdwGraph({
        ticketId: "TICKET-CWD",
        prompt: "aim the tree",
        cwd: "/tmp/named-git-tree",
      }).pipe(Effect.provide(layers));

      assert.strictEqual(result.status, AdwStatus.Failed);
      const seen = yield* Ref.get(createCwds);
      assert.deepStrictEqual(seen, ["/tmp/named-git-tree"]);
    })
  );

  it.effect("sandbox create defaults to process.cwd when cwd omitted", () =>
    Effect.gen(function* () {
      const createCwds = yield* Ref.make<string[]>([]);

      const layers = Layer.mergeAll(
        Layer.succeed(
          SandboxProvider,
          SandboxProvider.of({
            acquire: () => Effect.die("acquire unused in graph test"),
            create: (options) =>
              Effect.gen(function* () {
                yield* Ref.update(createCwds, (cs) => [
                  ...cs,
                  options?.cwd ?? "(missing)",
                ]);
                return {
                  id: "sandbox-default-cwd",
                  cwd: options?.cwd ?? monorepoRoot,
                  exec: () =>
                    Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
                  destroy: () => Effect.void,
                } satisfies Sandbox;
              }),
          })
        ),
        Layer.succeed(
          WorkspaceProvision,
          WorkspaceProvision.of({
            provision: () =>
              Effect.fail(new ProvisionError({ message: "stop after create" })),
          })
        ),
        Layer.succeed(
          BuildAgentProvider,
          BuildAgentProvider.of({
            run: () => Effect.die("unused"),
            resume: () => Effect.die("unused"),
          })
        ),
        Layer.succeed(
          ReviewAgentProvider,
          ReviewAgentProvider.of({
            run: () => Effect.die("unused"),
            resume: () => Effect.die("unused"),
          })
        ),
        Layer.succeed(
          GitHost,
          GitHost.of({
            commitWorkingTree: () => Effect.void,
            clone: () => Effect.void,
            push: () => Effect.void,
            openPullRequest: () =>
              Effect.succeed({ url: "https://example.test/pr/1" }),
            remoteBranchExists: () => Effect.succeed(false),
            findOpenPullRequest: () => Effect.succeed(null),
          })
        ),
        Layer.succeed(
          AdwTestCommands,
          AdwTestCommands.of({
            resolve: () => [
              { command: "node", args: ["-e", "process.exit(0)"] },
            ],
          })
        ),
        AdwBuildAttemptCap.Default,
        AdwReviewAttemptCap.Default,
        AdwSchemaResumeCap.Default
      );

      const result = yield* runMinimalAdwGraph({
        ticketId: "TICKET-DEFAULT-CWD",
        prompt: "self-build cwd",
      }).pipe(Effect.provide(layers));

      assert.strictEqual(result.status, AdwStatus.Failed);
      const seen = yield* Ref.get(createCwds);
      assert.deepStrictEqual(seen, [process.cwd()]);
    })
  );
});
