import { assert, describe, it } from "@effect/vitest";
import {
  BuildAgentProvider,
  ReviewAgentProvider,
  SandboxProvider,
  type Sandbox,
} from "@lazy-software-factory/runtime";
import { Effect, Layer, Ref } from "effect";
import { AdwBuildAttemptCap, AdwReviewAttemptCap } from "./attempt-caps.ts";
import { AdwStatus, ReviewVerdict } from "./enums.ts";
import { GitHost } from "./git-host.ts";
import { runMinimalAdw } from "./run-minimal-adw.ts";
import { AdwTestCommands } from "./test-commands.ts";
import { WorkspaceProvision } from "./workspace-provision.ts";

describe("runMinimalAdw happy path", () => {
  it.effect("provision → Build → Test → Review → Ship yields shipped", () =>
    Effect.gen(function* () {
      const steps = yield* Ref.make<string[]>([]);
      const pushThenPr = yield* Ref.make<string[]>([]);
      const record = (step: string) => Ref.update(steps, (s) => [...s, step]);

      const fakeSandboxLayer = Layer.succeed(
        SandboxProvider,
        SandboxProvider.of({
          create: () =>
            Effect.gen(function* () {
              yield* record("sandbox");
              const box: Sandbox = {
                id: "sandbox-1",
                cwd: "/tmp/sandbox-1",
                exec: (command, args = []) =>
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
                    if (command === "test" && args[0] === "-f") {
                      yield* record("provision-lockfile");
                      return {
                        exitCode: args[1] === "pnpm-lock.yaml" ? 0 : 1,
                        stdout: "",
                        stderr: "",
                      };
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
                  }),
                destroy: () => Effect.void,
              };
              return box;
            }),
        })
      );

      const provisionLayer = WorkspaceProvision.Host;

      const buildLayer = Layer.succeed(
        BuildAgentProvider,
        BuildAgentProvider.of({
          run: (options) =>
            Effect.gen(function* () {
              yield* record("build");
              assert.isDefined(options.sandbox);
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
              return {
                sessionId: "review-session-1",
                output: { verdict: ReviewVerdict.Pass },
              };
            }),
          resume: () => Effect.die("Review resume must not run on happy path"),
        })
      );

      const gitLayer = Layer.succeed(
        GitHost,
        GitHost.of({
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
        })
      );

      const testCommandsLayer = Layer.succeed(
        AdwTestCommands,
        AdwTestCommands.of({
          commands: [{ command: "node", args: ["-e", "process.exit(0)"] }],
        })
      );

      const result = yield* runMinimalAdw({
        ticketId: "TICKET-1",
        prompt: "implement the thing",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            fakeSandboxLayer,
            provisionLayer,
            buildLayer,
            reviewLayer,
            gitLayer,
            testCommandsLayer,
            AdwBuildAttemptCap.Default,
            AdwReviewAttemptCap.Default
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
        "provision-lockfile",
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
});
