import { assert, describe, it } from "@effect/vitest";
import {
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
import { runMinimalAdw } from "./run-minimal-adw.ts";
import { AdwTestCommands } from "./test-commands.ts";
import { ProvisionError, WorkspaceProvision } from "./workspace-provision.ts";
import { monorepoRoot } from "./monorepo-root.ts";

describe("runMinimalAdw provision failure", () => {
  it.effect("provision failure yields failed with zero agent runs", () =>
    Effect.gen(function* () {
      const buildRuns = yield* Ref.make(0);
      const reviewRuns = yield* Ref.make(0);
      const testRuns = yield* Ref.make(0);

      const layers = Layer.mergeAll(
        Layer.succeed(
          SandboxProvider,
          SandboxProvider.of({
            create: () =>
              Effect.succeed({
                id: "sandbox-1",
                cwd: monorepoRoot,
                exec: () =>
                  Effect.gen(function* () {
                    yield* Ref.update(testRuns, (n) => n + 1);
                    return { exitCode: 0, stdout: "", stderr: "" };
                  }),
                destroy: () => Effect.void,
              } satisfies Sandbox),
          })
        ),
        Layer.succeed(
          WorkspaceProvision,
          WorkspaceProvision.of({
            provision: () =>
              Effect.fail(
                new ProvisionError({ message: "locked install failed" })
              ),
          })
        ),
        Layer.succeed(
          BuildAgentProvider,
          BuildAgentProvider.of({
            run: () =>
              Effect.gen(function* () {
                yield* Ref.update(buildRuns, (n) => n + 1);
                return { sessionId: "build-session-1" };
              }),
            resume: () => Effect.die("unused"),
          })
        ),
        Layer.succeed(
          ReviewAgentProvider,
          ReviewAgentProvider.of({
            run: () =>
              Effect.gen(function* () {
                yield* Ref.update(reviewRuns, (n) => n + 1);
                return { sessionId: "review-session-1" };
              }),
            resume: () => Effect.die("unused"),
          })
        ),
        Layer.succeed(
          GitHost,
          GitHost.of({
            commitWorkingTree: () => Effect.void,
            clone: () => Effect.die("unused"),
            push: () => Effect.die("unused"),
            openPullRequest: () => Effect.die("unused"),
          })
        ),
        Layer.succeed(
          AdwTestCommands,
          AdwTestCommands.of({
            resolve: () => [{ command: "t" }],
          })
        ),
        AdwBuildAttemptCap.Default,
        AdwReviewAttemptCap.Default,
        AdwSchemaResumeCap.Default
      );

      const result = yield* runMinimalAdw({
        ticketId: "TICKET-1",
        prompt: "do the thing",
      }).pipe(Effect.provide(layers));

      assert.strictEqual(result.status, AdwStatus.Failed);
      assert.strictEqual(result.detail, "locked install failed");
      assert.strictEqual(yield* Ref.get(buildRuns), 0);
      assert.strictEqual(yield* Ref.get(reviewRuns), 0);
      assert.strictEqual(yield* Ref.get(testRuns), 0);
    })
  );
});
