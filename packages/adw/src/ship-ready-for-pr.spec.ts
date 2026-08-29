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
import { GitHost, GitHostError } from "./git-host.ts";
import { reviewPassFixture } from "./review-pass-fixture.ts";
import { runMinimalAdwGraph } from "./run-minimal-adw-graph.ts";
import { submitReviewPassViaTools } from "./review-tool-test-helpers.ts";
import { AdwTestCommands } from "./test-commands.ts";
import { WorkspaceProvision } from "./workspace-provision.ts";
import { monorepoRoot } from "./monorepo-root.ts";

const greenAgents = Layer.mergeAll(
  Layer.succeed(
    WorkspaceProvision,
    WorkspaceProvision.of({ provision: () => Effect.void })
  ),
  Layer.succeed(
    SandboxProvider,
    SandboxProvider.of({
      acquire: () => Effect.die("acquire unused in graph test"),
      create: () =>
        Effect.succeed({
          id: "sandbox-1",
          cwd: monorepoRoot,
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
      run: (options) =>
        Effect.gen(function* () {
          yield* submitReviewPassViaTools(options);
          return { sessionId: "review-session-1" };
        }),
      resume: () => Effect.die("unused"),
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

describe("runMinimalAdwGraph Ship → ready_for_pr", () => {
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
          run: (options) =>
            Effect.gen(function* () {
              yield* Ref.update(reviewRuns, (n) => n + 1);
              yield* submitReviewPassViaTools(options);
              return { sessionId: "review-session-1" };
            }),
          resume: () => Effect.die("unused"),
        })
      );

      const gitLayer = Layer.succeed(
        GitHost,
        GitHost.of({
          commitWorkingTree: () => Effect.void,
          clone: () => Effect.void,
          push: () =>
            Effect.fail(new GitHostError({ message: "gh not available" })),
          openPullRequest: () => Effect.die("PR must not run after push fail"),
          remoteBranchExists: () => Effect.succeed(false),
          findOpenPullRequest: () => Effect.succeed(null),
        })
      );

      const result = yield* runMinimalAdwGraph({
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
          commitWorkingTree: () => Effect.void,
          clone: () => Effect.void,
          push: () => Ref.set(pushed, true),
          openPullRequest: () =>
            Effect.fail(new GitHostError({ message: "cannot open PR" })),
          remoteBranchExists: () => Effect.succeed(false),
          findOpenPullRequest: () => Effect.succeed(null),
        })
      );

      const result = yield* runMinimalAdwGraph({
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
      const opened = yield* Ref.make<{ title: string; body?: string } | null>(
        null
      );
      const draft = reviewPassFixture({
        prTitle: "feat: ship draft from review",
        prBody: "## Summary\n- from Review pass",
      });

      const reviewLayer = Layer.succeed(
        ReviewAgentProvider,
        ReviewAgentProvider.of({
          run: (options) =>
            Effect.gen(function* () {
              yield* submitReviewPassViaTools(options, draft);
              return { sessionId: "review-session-1" };
            }),
          resume: () => Effect.die("unused"),
        })
      );

      const gitLayer = Layer.succeed(
        GitHost,
        GitHost.of({
          commitWorkingTree: () => Effect.void,
          clone: () => Effect.void,
          push: () => Effect.void,
          openPullRequest: (opts) =>
            Effect.gen(function* () {
              yield* Ref.set(opened, { title: opts.title, body: opts.body });
              return { url: "https://example.test/pr/9" };
            }),
          remoteBranchExists: () => Effect.succeed(false),
          findOpenPullRequest: () => Effect.succeed(null),
        })
      );

      const result = yield* runMinimalAdwGraph({
        ticketId: "T-OK",
        prompt: "work",
      }).pipe(
        Effect.provide(Layer.mergeAll(greenAgents, reviewLayer, gitLayer))
      );

      assert.strictEqual(result.status, AdwStatus.Shipped);
      assert.strictEqual(result.prUrl, "https://example.test/pr/9");
      assert.deepStrictEqual(yield* Ref.get(opened), {
        title: draft.prTitle,
        body: draft.prBody,
      });
    })
  );

  it.effect("Ship runs commit then push then openPR", () =>
    Effect.gen(function* () {
      const steps = yield* Ref.make<string[]>([]);

      const gitLayer = Layer.succeed(
        GitHost,
        GitHost.of({
          commitWorkingTree: () => Ref.update(steps, (s) => [...s, "commit"]),
          clone: () => Effect.void,
          push: () => Ref.update(steps, (s) => [...s, "push"]),
          openPullRequest: () =>
            Effect.gen(function* () {
              yield* Ref.update(steps, (s) => [...s, "pr"]);
              return { url: "https://example.test/pr/10" };
            }),
          remoteBranchExists: () => Effect.succeed(false),
          findOpenPullRequest: () => Effect.succeed(null),
        })
      );

      const result = yield* runMinimalAdwGraph({
        ticketId: "T-ORDER",
        prompt: "work",
      }).pipe(Effect.provide(Layer.mergeAll(greenAgents, gitLayer)));

      assert.strictEqual(result.status, AdwStatus.Shipped);
      assert.deepStrictEqual(yield* Ref.get(steps), ["commit", "push", "pr"]);
    })
  );

  it.effect("commit failure yields ready_for_pr without push", () =>
    Effect.gen(function* () {
      const pushed = yield* Ref.make(false);

      const gitLayer = Layer.succeed(
        GitHost,
        GitHost.of({
          commitWorkingTree: () =>
            Effect.fail(new GitHostError({ message: "commit failed" })),
          clone: () => Effect.void,
          push: () => Ref.set(pushed, true),
          openPullRequest: () => Effect.die("unused"),
          remoteBranchExists: () => Effect.succeed(false),
          findOpenPullRequest: () => Effect.succeed(null),
        })
      );

      const result = yield* runMinimalAdwGraph({
        ticketId: "T-COMMIT",
        prompt: "work",
      }).pipe(Effect.provide(Layer.mergeAll(greenAgents, gitLayer)));

      assert.strictEqual(result.status, AdwStatus.ReadyForPr);
      assert.include(
        result.detail,
        "Ship commit failed: GitHostError: commit failed"
      );
      assert.isFalse(yield* Ref.get(pushed));
    })
  );
});
