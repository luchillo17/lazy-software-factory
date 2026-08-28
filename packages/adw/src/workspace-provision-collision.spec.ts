import { assert, describe, it } from "@effect/vitest";
import {
  BuildAgentProvider,
  ReviewAgentProvider,
  SandboxProvider,
  type Sandbox,
} from "@lazy-software-factory/runtime";
import { Effect, Exit, Layer, Ref } from "effect";
import {
  AdwBuildAttemptCap,
  AdwReviewAttemptCap,
  AdwSchemaResumeCap,
} from "./attempt-caps.ts";
import { AdwStatus } from "./enums.ts";
import { stubGitHost } from "./git-host-stub.ts";
import { GitHost, type GitHostService } from "./git-host.ts";
import { monorepoRoot } from "./monorepo-root.ts";
import { runMinimalAdw } from "./run-minimal-adw.ts";
import { AdwTestCommands } from "./test-commands.ts";
import { WorkspaceProvision } from "./workspace-provision.ts";

type ExecCall = {
  readonly command: string;
  readonly args: readonly string[];
};

const recordingSandbox = (calls: Ref.Ref<ExecCall[]>): Sandbox => ({
  id: "sandbox-1",
  cwd: "/tmp/sandbox-1",
  exec: (command, args = []) =>
    Effect.gen(function* () {
      yield* Ref.update(calls, (c) => [...c, { command, args: [...args] }]);
      if (command === "git" && args[0] === "rev-parse") {
        return { exitCode: 0, stdout: ".git\n", stderr: "" };
      }
      if (command === "git" && args[0] === "checkout") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (command === "test") {
        return { exitCode: 1, stdout: "", stderr: "" };
      }
      return {
        exitCode: 1,
        stdout: "",
        stderr: `unexpected: ${command} ${args.join(" ")}`,
      };
    }),
  destroy: () => Effect.void,
});

const provisionWith = (sandbox: Sandbox, git: ReturnType<typeof stubGitHost>) =>
  Effect.gen(function* () {
    const provisioner = yield* WorkspaceProvision;
    return yield* provisioner
      .provision({ sandbox, ticketId: "55" })
      .pipe(Effect.exit);
  }).pipe(
    Effect.provide(
      WorkspaceProvision.Host.pipe(Layer.provide(Layer.succeed(GitHost, git)))
    )
  );

const minimalAdwCollisionLayers = (options: {
  readonly gitOverrides: Partial<GitHostService>;
  readonly buildRuns: Ref.Ref<number>;
  readonly reviewRuns: Ref.Ref<number>;
  readonly shipCalls: Ref.Ref<number>;
}) =>
  Layer.mergeAll(
    Layer.succeed(
      SandboxProvider,
      SandboxProvider.of({
        create: () =>
          Effect.succeed({
            id: "sandbox-1",
            cwd: monorepoRoot,
            exec: (command, args = []) =>
              Effect.succeed(
                command === "git" && args[0] === "rev-parse"
                  ? { exitCode: 0, stdout: ".git\n", stderr: "" }
                  : {
                      exitCode: 1,
                      stdout: "",
                      stderr: `unexpected ${command}`,
                    }
              ),
            destroy: () => Effect.void,
          } satisfies Sandbox),
      })
    ),
    WorkspaceProvision.Host.pipe(
      Layer.provide(
        Layer.succeed(
          GitHost,
          stubGitHost({
            ...options.gitOverrides,
            push: () =>
              Effect.gen(function* () {
                yield* Ref.update(options.shipCalls, (n) => n + 1);
              }),
            openPullRequest: () =>
              Effect.gen(function* () {
                yield* Ref.update(options.shipCalls, (n) => n + 1);
                return { url: "https://example.test/pr/1" };
              }),
          })
        )
      )
    ),
    Layer.succeed(
      BuildAgentProvider,
      BuildAgentProvider.of({
        run: () =>
          Effect.gen(function* () {
            yield* Ref.update(options.buildRuns, (n) => n + 1);
            return { sessionId: "build-1" };
          }),
        resume: () => Effect.die("unused"),
      })
    ),
    Layer.succeed(
      ReviewAgentProvider,
      ReviewAgentProvider.of({
        run: () =>
          Effect.gen(function* () {
            yield* Ref.update(options.reviewRuns, (n) => n + 1);
            return { sessionId: "review-1" };
          }),
        resume: () => Effect.die("unused"),
      })
    ),
    Layer.succeed(
      AdwTestCommands,
      AdwTestCommands.of({ resolve: () => [{ command: "t" }] })
    ),
    AdwBuildAttemptCap.Default,
    AdwReviewAttemptCap.Default,
    AdwSchemaResumeCap.Default
  );

describe("WorkspaceProvision ticket-branch collision preflight", () => {
  it.effect(
    "fails before checkout when remote ticket branch already exists",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make<ExecCall[]>([]);
        const sandbox = recordingSandbox(calls);

        const result = yield* provisionWith(
          sandbox,
          stubGitHost({
            remoteBranchExists: () => Effect.succeed(true),
          })
        );

        assert.isTrue(Exit.isFailure(result));
        if (Exit.isFailure(result)) {
          assert.isTrue(
            String(result.cause).includes(
              "Ticket branch adw/55 already exists on remote origin (refusing overwrite; no force-push)."
            )
          );
        }

        const observed = yield* Ref.get(calls);
        assert.isFalse(
          observed.some((c) => c.command === "git" && c.args[0] === "checkout"),
          "must not checkout when remote branch collision"
        );
      })
  );

  it.effect(
    "fails before checkout when open PR exists for ticket head and includes URL",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make<ExecCall[]>([]);
        const sandbox = recordingSandbox(calls);
        const prUrl = "https://github.com/example/repo/pull/49";

        const result = yield* provisionWith(
          sandbox,
          stubGitHost({
            findOpenPullRequest: () => Effect.succeed({ url: prUrl }),
          })
        );

        assert.isTrue(Exit.isFailure(result));
        if (Exit.isFailure(result)) {
          const detail = String(result.cause);
          assert.isTrue(
            detail.includes(
              `Open pull request already exists for head adw/55: ${prUrl}`
            )
          );
          assert.isTrue(detail.includes("no force-push"));
        }

        const observed = yield* Ref.get(calls);
        assert.isFalse(
          observed.some((c) => c.command === "git" && c.args[0] === "checkout")
        );
      })
  );

  it.effect(
    "fails with remote + PR detail when both collisions are present",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make<ExecCall[]>([]);
        const sandbox = recordingSandbox(calls);
        const prUrl = "https://github.com/example/repo/pull/49";

        const result = yield* provisionWith(
          sandbox,
          stubGitHost({
            remoteBranchExists: () => Effect.succeed(true),
            findOpenPullRequest: () => Effect.succeed({ url: prUrl }),
          })
        );

        assert.isTrue(Exit.isFailure(result));
        if (Exit.isFailure(result)) {
          const detail = String(result.cause);
          assert.isTrue(
            detail.includes(
              "Ticket branch adw/55 already exists on remote origin"
            )
          );
          assert.isTrue(detail.includes(`Open PR: ${prUrl}`));
        }

        assert.isFalse(
          (yield* Ref.get(calls)).some(
            (c) => c.command === "git" && c.args[0] === "checkout"
          )
        );
      })
  );

  it.effect("checks out ticket branch when remote and open PR are clear", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ExecCall[]>([]);
      const sandbox = recordingSandbox(calls);

      const result = yield* provisionWith(sandbox, stubGitHost());

      assert.isTrue(Exit.isSuccess(result));
      const observed = yield* Ref.get(calls);
      assert.deepStrictEqual(
        observed.map((c) => [c.command, ...c.args]),
        [
          ["git", "rev-parse", "--git-dir"],
          ["git", "checkout", "-B", "adw/55"],
          ["test", "-f", "pnpm-lock.yaml"],
        ]
      );
    })
  );

  it.effect(
    "Minimal ADW fails with zero Build/Review runs when remote branch exists",
    () =>
      Effect.gen(function* () {
        const buildRuns = yield* Ref.make(0);
        const reviewRuns = yield* Ref.make(0);
        const shipCalls = yield* Ref.make(0);

        const result = yield* runMinimalAdw({
          ticketId: "55",
          prompt: "do the thing",
        }).pipe(
          Effect.provide(
            minimalAdwCollisionLayers({
              gitOverrides: {
                remoteBranchExists: () => Effect.succeed(true),
              },
              buildRuns,
              reviewRuns,
              shipCalls,
            })
          )
        );

        assert.strictEqual(result.status, AdwStatus.Failed);
        assert.isTrue(
          (result.detail ?? "").includes(
            "Ticket branch adw/55 already exists on remote origin"
          )
        );
        assert.strictEqual(yield* Ref.get(buildRuns), 0);
        assert.strictEqual(yield* Ref.get(reviewRuns), 0);
        assert.strictEqual(yield* Ref.get(shipCalls), 0);
      })
  );

  it.effect(
    "Minimal ADW fails with zero agent runs when open PR exists for ticket head",
    () =>
      Effect.gen(function* () {
        const buildRuns = yield* Ref.make(0);
        const reviewRuns = yield* Ref.make(0);
        const shipCalls = yield* Ref.make(0);
        const prUrl = "https://github.com/example/repo/pull/49";

        const result = yield* runMinimalAdw({
          ticketId: "55",
          prompt: "do the thing",
        }).pipe(
          Effect.provide(
            minimalAdwCollisionLayers({
              gitOverrides: {
                findOpenPullRequest: () => Effect.succeed({ url: prUrl }),
              },
              buildRuns,
              reviewRuns,
              shipCalls,
            })
          )
        );

        assert.strictEqual(result.status, AdwStatus.Failed);
        assert.isTrue((result.detail ?? "").includes(prUrl));
        assert.strictEqual(yield* Ref.get(buildRuns), 0);
        assert.strictEqual(yield* Ref.get(reviewRuns), 0);
        assert.strictEqual(yield* Ref.get(shipCalls), 0);
      })
  );
});
