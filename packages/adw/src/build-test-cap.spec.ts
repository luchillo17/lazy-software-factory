import { assert, describe, it } from "@effect/vitest";
import {
  BuildAgentProvider,
  ReviewAgentProvider,
  SandboxProvider,
  type AgentSession,
  type Sandbox,
} from "@lazy-software-factory/runtime";
import { Effect, Layer, Ref } from "effect";
import {
  AdwBuildAttemptCap,
  AdwReviewAttemptCap,
  AdwSchemaResumeCap,
} from "./attempt-caps.ts";
import { AdwStatus, ReviewVerdict } from "./enums.ts";
import { GitHost } from "./git-host.ts";
import { runMinimalAdw } from "./run-minimal-adw.ts";
import { AdwTestCommands } from "./test-commands.ts";
import { WorkspaceProvision } from "./workspace-provision.ts";
import { monorepoRoot } from "./monorepo-root.ts";

const passThroughShip = Layer.mergeAll(
  Layer.succeed(
    WorkspaceProvision,
    WorkspaceProvision.of({ provision: () => Effect.void })
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
    GitHost,
    GitHost.of({
      commitWorkingTree: () => Effect.void,
      clone: () => Effect.void,
      push: () => Effect.void,
      openPullRequest: () =>
        Effect.succeed({ url: "https://example.test/pr/1" }),
    })
  ),
  Layer.succeed(
    AdwTestCommands,
    AdwTestCommands.of({
      commands: [{ command: "test", args: [] }],
    })
  )
);

const passThroughShipWithoutGates = Layer.mergeAll(
  Layer.succeed(
    WorkspaceProvision,
    WorkspaceProvision.of({ provision: () => Effect.void })
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
    GitHost,
    GitHost.of({
      commitWorkingTree: () => Effect.void,
      clone: () => Effect.void,
      push: () => Effect.void,
      openPullRequest: () =>
        Effect.succeed({ url: "https://example.test/pr/1" }),
    })
  )
);

describe("runMinimalAdw Build↔Test resume + cap", () => {
  it.effect("Test fail resumes same Build session with gate output", () =>
    Effect.gen(function* () {
      const resumes = yield* Ref.make<
        Array<{ sessionId: string; prompt: string }>
      >([]);
      const testPass = yield* Ref.make(false);

      const sandboxLayer = Layer.succeed(
        SandboxProvider,
        SandboxProvider.of({
          create: () =>
            Effect.succeed({
              id: "sandbox-1",
              cwd: monorepoRoot,
              exec: () =>
                Effect.gen(function* () {
                  const pass = yield* Ref.get(testPass);
                  if (!pass) {
                    yield* Ref.set(testPass, true);
                    return {
                      exitCode: 1,
                      stdout: "expected 1",
                      stderr: "got 0",
                    };
                  }
                  return { exitCode: 0, stdout: "ok", stderr: "" };
                }),
              destroy: () => Effect.void,
            } satisfies Sandbox),
        })
      );

      const buildLayer = Layer.succeed(
        BuildAgentProvider,
        BuildAgentProvider.of({
          run: () => Effect.succeed({ sessionId: "build-session-1" }),
          resume: (session, options) =>
            Effect.gen(function* () {
              yield* Ref.update(resumes, (rs) => [
                ...rs,
                { sessionId: session.sessionId, prompt: options.prompt },
              ]);
              assert.strictEqual(session.sessionId, "build-session-1");
              return session;
            }),
        })
      );

      const result = yield* runMinimalAdw({
        ticketId: "T-RESUME",
        prompt: "fix it",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            sandboxLayer,
            buildLayer,
            passThroughShip,
            AdwBuildAttemptCap.Default,
            AdwReviewAttemptCap.Default,
            AdwSchemaResumeCap.Default
          )
        )
      );

      assert.strictEqual(result.status, AdwStatus.Shipped);
      assert.strictEqual(result.buildSessionId, "build-session-1");

      const seen = yield* Ref.get(resumes);
      assert.strictEqual(seen.length, 1);
      assert.strictEqual(seen[0]?.sessionId, "build-session-1");
      assert.isTrue(seen[0]!.prompt.includes("got 0"));
      assert.isTrue(seen[0]!.prompt.includes("expected 1"));
    })
  );

  it.effect(
    "exhausting Build attempt cap yields failed with last gate detail",
    () =>
      Effect.gen(function* () {
        const buildCalls = yield* Ref.make(0);

        const sandboxLayer = Layer.succeed(
          SandboxProvider,
          SandboxProvider.of({
            create: () =>
              Effect.succeed({
                id: "sandbox-1",
                cwd: monorepoRoot,
                exec: () =>
                  Effect.succeed({
                    exitCode: 1,
                    stdout: "",
                    stderr: "still red",
                  }),
                destroy: () => Effect.void,
              } satisfies Sandbox),
          })
        );

        const buildLayer = Layer.succeed(
          BuildAgentProvider,
          BuildAgentProvider.of({
            run: () =>
              Effect.gen(function* () {
                yield* Ref.update(buildCalls, (n) => n + 1);
                return { sessionId: "build-session-1" } satisfies AgentSession;
              }),
            resume: (session) =>
              Effect.gen(function* () {
                yield* Ref.update(buildCalls, (n) => n + 1);
                return session;
              }),
          })
        );

        const capLayer = Layer.succeed(
          AdwBuildAttemptCap,
          AdwBuildAttemptCap.of({ maxAttempts: 3 })
        );

        const result = yield* runMinimalAdw({
          ticketId: "T-CAP",
          prompt: "never passes",
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              sandboxLayer,
              buildLayer,
              passThroughShip,
              capLayer,
              AdwReviewAttemptCap.Default,
              AdwSchemaResumeCap.Default
            )
          )
        );

        assert.strictEqual(result.status, AdwStatus.Failed);
        assert.isTrue(result.detail?.includes("still red"));
        assert.strictEqual(result.buildSessionId, "build-session-1");
        assert.strictEqual(result.sandboxId, "sandbox-1");

        const calls = yield* Ref.get(buildCalls);
        assert.strictEqual(calls, 3);
      })
  );

  it.effect(
    "multiple check gates all run; Build resume gets combined fail report",
    () =>
      Effect.gen(function* () {
        const resumes = yield* Ref.make<string[]>([]);
        const round = yield* Ref.make(0);

        const sandboxLayer = Layer.succeed(
          SandboxProvider,
          SandboxProvider.of({
            create: () =>
              Effect.succeed({
                id: "sandbox-1",
                cwd: monorepoRoot,
                exec: (command) =>
                  Effect.gen(function* () {
                    const n = yield* Ref.get(round);
                    if (n === 0) {
                      if (command === "lint") {
                        return {
                          exitCode: 1,
                          stdout: "",
                          stderr: "lint-red",
                        };
                      }
                      if (command === "format-check") {
                        return {
                          exitCode: 1,
                          stdout: "",
                          stderr: "format-red",
                        };
                      }
                      return { exitCode: 0, stdout: "ok", stderr: "" };
                    }
                    return { exitCode: 0, stdout: "ok", stderr: "" };
                  }),
                destroy: () => Effect.void,
              } satisfies Sandbox),
          })
        );

        const buildLayer = Layer.succeed(
          BuildAgentProvider,
          BuildAgentProvider.of({
            run: () => Effect.succeed({ sessionId: "build-session-1" }),
            resume: (session, options) =>
              Effect.gen(function* () {
                yield* Ref.update(resumes, (rs) => [...rs, options.prompt]);
                yield* Ref.update(round, (n) => n + 1);
                return session;
              }),
          })
        );

        const result = yield* runMinimalAdw({
          ticketId: "T-PARALLEL",
          prompt: "fix gates",
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              sandboxLayer,
              buildLayer,
              passThroughShipWithoutGates,
              Layer.succeed(
                AdwTestCommands,
                AdwTestCommands.of({
                  commands: [
                    { command: "lint" },
                    { command: "format-check" },
                    { command: "unit" },
                  ],
                })
              ),
              AdwBuildAttemptCap.Default,
              AdwReviewAttemptCap.Default,
              AdwSchemaResumeCap.Default
            )
          )
        );

        assert.strictEqual(result.status, AdwStatus.Shipped);
        const seen = yield* Ref.get(resumes);
        assert.strictEqual(seen.length, 1);
        assert.isTrue(seen[0]!.includes("lint-red"));
        assert.isTrue(seen[0]!.includes("format-red"));
        assert.isTrue(seen[0]!.includes("lint"));
        assert.isTrue(seen[0]!.includes("format-check"));
      })
  );
});
