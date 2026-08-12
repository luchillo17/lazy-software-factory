import { assert, describe, it } from "@effect/vitest";
import { SandboxExecError, type Sandbox } from "@lazy-software-factory/runtime";
import { Effect, Logger } from "effect";
import { captureAdwProgressLogger } from "./adw-progress.ts";
import { TestAgentOutcome, runTestAgent } from "./test-agent.ts";

const sandboxWith = (exec: Sandbox["exec"]): Sandbox => ({
  id: "sandbox-1",
  cwd: "/tmp",
  exec,
  destroy: () => Effect.void,
});

describe("runTestAgent", () => {
  it.effect("returns green when every gate exits 0", () =>
    Effect.gen(function* () {
      const result = yield* runTestAgent({
        sandbox: sandboxWith(() =>
          Effect.succeed({ exitCode: 0, stdout: "ok", stderr: "" })
        ),
        commands: [{ command: "lint" }, { command: "test", args: ["-q"] }],
        buildAttempts: 1,
        reviewAttempts: 0,
      });
      assert.strictEqual(result.outcome, TestAgentOutcome.Green);
    })
  );

  it.effect(
    "returns red with combined detail when any gate exits non-zero",
    () =>
      Effect.gen(function* () {
        const result = yield* runTestAgent({
          sandbox: sandboxWith((command) =>
            Effect.succeed(
              command === "fail"
                ? { exitCode: 1, stdout: "expected 1", stderr: "got 0" }
                : { exitCode: 0, stdout: "", stderr: "" }
            )
          ),
          commands: [{ command: "ok" }, { command: "fail" }],
          buildAttempts: 2,
          reviewAttempts: 1,
        });
        assert.strictEqual(result.outcome, TestAgentOutcome.Red);
        if (result.outcome === TestAgentOutcome.Red) {
          assert.isTrue(result.detail.includes("fail"));
          assert.isTrue(result.detail.includes("expected 1"));
          assert.isTrue(result.detail.includes("1 check gate"));
        }
      })
  );

  it.effect("returns execFail when sandbox.exec errors", () =>
    Effect.gen(function* () {
      const result = yield* runTestAgent({
        sandbox: sandboxWith(() =>
          Effect.fail(
            new SandboxExecError({
              message: "spawn ENOENT",
            })
          )
        ),
        commands: [{ command: "missing" }],
        buildAttempts: 1,
        reviewAttempts: 0,
      });
      assert.strictEqual(result.outcome, TestAgentOutcome.ExecFail);
      if (result.outcome === TestAgentOutcome.ExecFail) {
        assert.isTrue(result.detail.includes("missing"));
        assert.isTrue(result.detail.includes("spawn ENOENT"));
      }
    })
  );

  it.effect("emits Test StepEnter and StepResult ok on green", () =>
    Effect.gen(function* () {
      const lines: string[] = [];
      yield* runTestAgent({
        sandbox: sandboxWith(() =>
          Effect.succeed({ exitCode: 0, stdout: "", stderr: "" })
        ),
        commands: [{ command: "t" }],
        buildAttempts: 1,
        reviewAttempts: 0,
      }).pipe(Effect.provide(Logger.layer([captureAdwProgressLogger(lines)])));

      assert.isTrue(
        lines.some((l) => l.includes("step_enter") && l.includes("test"))
      );
      assert.isTrue(
        lines.some(
          (l) =>
            l.includes("step_result") &&
            l.includes("test") &&
            l.includes("result=ok")
        )
      );
    })
  );
});
