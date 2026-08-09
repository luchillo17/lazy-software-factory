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
import { GitHost, GitHostError } from "./git-host.ts";
import { runMinimalAdw } from "./run-minimal-adw.ts";
import { AdwTestCommands } from "./test-commands.ts";
import { WorkspaceProvision } from "./workspace-provision.ts";

const greenAgents = Layer.mergeAll(
  Layer.succeed(
    WorkspaceProvision,
    WorkspaceProvision.of({ provision: () => Effect.void })
  ),
  Layer.succeed(
    SandboxProvider,
    SandboxProvider.of({
      create: () =>
        Effect.succeed({
          id: "sandbox-1",
          cwd: "/tmp/sandbox-1",
          exec: () => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
          destroy: () => Effect.void,
        } satisfies Sandbox),
    })
  ),
  Layer.succeed(
    BuildAgentProvider,
    BuildAgentProvider.of({
      run: () => Effect.succeed({ sessionId: "build-session-1" }),
      resume: () => Effect.die("Build resume must not run"),
    })
  ),
  Layer.succeed(
    ReviewAgentProvider,
    ReviewAgentProvider.of({
      run: () =>
        Effect.succeed({
          sessionId: "review-session-1",
          output: { verdict: ReviewVerdict.Pass },
        }),
      resume: () => Effect.die("unused"),
    })
  ),
  Layer.succeed(
    AdwTestCommands,
    AdwTestCommands.of({ commands: [{ command: "t" }] })
  ),
  AdwBuildAttemptCap.Default,
  AdwReviewAttemptCap.Default
);

describe("runMinimalAdw Ship → ready_for_pr", () => {
  it.effect("push failure yields ready_for_pr without spending attempts", () =>
    Effect.gen(function* () {
      const buildResumes = yield* Ref.make(0);
      const reviewRuns = yield* Ref.make(0);

      const buildLayer = Layer.succeed(
        BuildAgentProvider,
        BuildAgentProvider.of({
          run: () => Effect.succeed({ sessionId: "build-session-1" }),
          resume: (session) =>
            Effect.gen(function* () {
              yield* Ref.update(buildResumes, (n) => n + 1);
              return session;
            }),
        })
      );

      const reviewLayer = Layer.succeed(
        ReviewAgentProvider,
        ReviewAgentProvider.of({
          run: () =>
            Effect.gen(function* () {
              yield* Ref.update(reviewRuns, (n) => n + 1);
              return {
                sessionId: "review-session-1",
                output: { verdict: ReviewVerdict.Pass },
              };
            }),
          resume: () => Effect.die("unused"),
        })
      );

      const gitLayer = Layer.succeed(
        GitHost,
        GitHost.of({
          clone: () => Effect.void,
          push: () =>
            Effect.fail(new GitHostError({ message: "gh not available" })),
          openPullRequest: () => Effect.die("PR must not run after push fail"),
        })
      );

      const result = yield* runMinimalAdw({
        ticketId: "T-SHIP",
        prompt: "work",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(greenAgents, buildLayer, reviewLayer, gitLayer)
        )
      );

      assert.strictEqual(result.status, AdwStatus.ReadyForPr);
      assert.strictEqual(result.buildSessionId, "build-session-1");
      assert.strictEqual(result.reviewSessionId, "review-session-1");
      assert.isUndefined(result.prUrl);
      assert.strictEqual(yield* Ref.get(buildResumes), 0);
      assert.strictEqual(yield* Ref.get(reviewRuns), 1);
    })
  );

  it.effect("open PR failure yields ready_for_pr after successful push", () =>
    Effect.gen(function* () {
      const pushed = yield* Ref.make(false);

      const gitLayer = Layer.succeed(
        GitHost,
        GitHost.of({
          clone: () => Effect.void,
          push: () => Ref.set(pushed, true),
          openPullRequest: () =>
            Effect.fail(new GitHostError({ message: "cannot open PR" })),
        })
      );

      const result = yield* runMinimalAdw({
        ticketId: "T-PR",
        prompt: "work",
      }).pipe(Effect.provide(Layer.mergeAll(greenAgents, gitLayer)));

      assert.strictEqual(result.status, AdwStatus.ReadyForPr);
      assert.isTrue(yield* Ref.get(pushed));
      assert.isUndefined(result.prUrl);
    })
  );

  it.effect("successful push+PR still yields shipped", () =>
    Effect.gen(function* () {
      const gitLayer = Layer.succeed(
        GitHost,
        GitHost.of({
          clone: () => Effect.void,
          push: () => Effect.void,
          openPullRequest: () =>
            Effect.succeed({ url: "https://example.test/pr/9" }),
        })
      );

      const result = yield* runMinimalAdw({
        ticketId: "T-OK",
        prompt: "work",
      }).pipe(Effect.provide(Layer.mergeAll(greenAgents, gitLayer)));

      assert.strictEqual(result.status, AdwStatus.Shipped);
      assert.strictEqual(result.prUrl, "https://example.test/pr/9");
    })
  );
});
