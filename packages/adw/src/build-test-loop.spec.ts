import { assert, describe, it } from "@effect/vitest";
import {
  SandboxExecError,
  type AgentProviderService,
  type AgentSession,
  type Sandbox,
} from "@lazy-software-factory/runtime";
import { Effect, Logger, Ref } from "effect";
import { captureAdwProgressLogger } from "./adw-progress.ts";
import { BuildTestOutcome, runBuildTestLoop } from "./build-test-loop.ts";

const sandboxWith = (exec: Sandbox["exec"]): Sandbox => ({
  id: "sandbox-1",
  cwd: "/tmp",
  exec,
  destroy: () => Effect.void,
});

const session = (sessionId = "build-1"): AgentSession => ({ sessionId });

describe("runBuildTestLoop", () => {
  it.effect("returns green when Test gates pass on first try", () =>
    Effect.gen(function* () {
      const buildAgent: AgentProviderService = {
        run: () => Effect.die("unused"),
        resume: () => Effect.die("unused"),
      };
      const result = yield* runBuildTestLoop({
        buildAgent,
        sandbox: sandboxWith(() =>
          Effect.succeed({ exitCode: 0, stdout: "ok", stderr: "" })
        ),
        commands: [{ command: "test" }],
        buildSession: session(),
        buildAttempts: 1,
        reviewAttempts: 0,
        buildAttemptCap: 3,
      });
      assert.strictEqual(result.outcome, BuildTestOutcome.Green);
      if (result.outcome === BuildTestOutcome.Green) {
        assert.strictEqual(result.buildSession.sessionId, "build-1");
        assert.strictEqual(result.buildAttempts, 1);
      }
    })
  );

  it.effect("resumes Build on red Test and spends a Build attempt", () =>
    Effect.gen(function* () {
      const resumes = yield* Ref.make(0);
      const pass = yield* Ref.make(false);
      const buildAgent: AgentProviderService = {
        run: () => Effect.die("unused"),
        resume: (prev, options) =>
          Effect.gen(function* () {
            yield* Ref.update(resumes, (n) => n + 1);
            assert.isTrue(String(options.prompt).includes("check gate"));
            return session(prev.sessionId);
          }),
      };
      const result = yield* runBuildTestLoop({
        buildAgent,
        sandbox: sandboxWith(() =>
          Effect.gen(function* () {
            if (!(yield* Ref.get(pass))) {
              yield* Ref.set(pass, true);
              return {
                exitCode: 1,
                stdout: "fail",
                stderr: "",
              };
            }
            return { exitCode: 0, stdout: "ok", stderr: "" };
          })
        ),
        commands: [{ command: "test" }],
        buildSession: session(),
        buildAttempts: 1,
        reviewAttempts: 0,
        buildAttemptCap: 3,
      });
      assert.strictEqual(result.outcome, BuildTestOutcome.Green);
      assert.strictEqual(yield* Ref.get(resumes), 1);
      if (result.outcome === BuildTestOutcome.Green) {
        assert.strictEqual(result.buildAttempts, 2);
      }
    })
  );

  it.effect("returns capExhausted when Build attempts hit cap on red", () =>
    Effect.gen(function* () {
      const buildAgent: AgentProviderService = {
        run: () => Effect.die("unused"),
        resume: () => Effect.die("should not resume at cap"),
      };
      const result = yield* runBuildTestLoop({
        buildAgent,
        sandbox: sandboxWith(() =>
          Effect.succeed({ exitCode: 1, stdout: "still red", stderr: "" })
        ),
        commands: [{ command: "test" }],
        buildSession: session(),
        buildAttempts: 2,
        reviewAttempts: 1,
        buildAttemptCap: 2,
      });
      assert.strictEqual(result.outcome, BuildTestOutcome.CapExhausted);
      if (result.outcome === BuildTestOutcome.CapExhausted) {
        assert.isTrue(result.detail.includes("still red"));
        assert.strictEqual(result.buildAttempts, 2);
      }
    })
  );

  it.effect("returns execFail without Build resume", () =>
    Effect.gen(function* () {
      const buildAgent: AgentProviderService = {
        run: () => Effect.die("unused"),
        resume: () => Effect.die("unused"),
      };
      const result = yield* runBuildTestLoop({
        buildAgent,
        sandbox: sandboxWith(() =>
          Effect.fail(new SandboxExecError({ message: "boom" }))
        ),
        commands: [{ command: "gone" }],
        buildSession: session(),
        buildAttempts: 1,
        reviewAttempts: 0,
        buildAttemptCap: 3,
      });
      assert.strictEqual(result.outcome, BuildTestOutcome.ExecFail);
      if (result.outcome === BuildTestOutcome.ExecFail) {
        assert.isTrue(result.detail.includes("boom"));
      }
    })
  );

  it.effect("emits BuildResume progress when resuming after red Test", () =>
    Effect.gen(function* () {
      const lines: string[] = [];
      const pass = yield* Ref.make(false);
      const buildAgent: AgentProviderService = {
        run: () => Effect.die("unused"),
        resume: (prev) => Effect.succeed(session(prev.sessionId)),
      };
      yield* runBuildTestLoop({
        buildAgent,
        sandbox: sandboxWith(() =>
          Effect.gen(function* () {
            if (!(yield* Ref.get(pass))) {
              yield* Ref.set(pass, true);
              return { exitCode: 1, stdout: "x", stderr: "" };
            }
            return { exitCode: 0, stdout: "", stderr: "" };
          })
        ),
        commands: [{ command: "t" }],
        buildSession: session(),
        buildAttempts: 1,
        reviewAttempts: 0,
        buildAttemptCap: 3,
      }).pipe(Effect.provide(Logger.layer([captureAdwProgressLogger(lines)])));

      assert.isTrue(lines.some((l) => l.includes("build_resume")));
    })
  );
});
