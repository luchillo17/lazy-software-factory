import { assert, describe, it } from "@effect/vitest";
import { SandboxExecError, type Sandbox } from "@lazy-software-factory/runtime";
import { Effect, Logger } from "effect";
import { captureAdwProgressLogger } from "./adw-progress.ts";
import {
  SeamConfirmOutcome,
  runSeamConfirmAgent,
} from "./seam-confirm-agent.ts";

const sandboxWith = (exec: Sandbox["exec"]): Sandbox => ({
  id: "sandbox-1",
  cwd: "/tmp",
  exec,
  destroy: () => Effect.void,
});

const emptyDeltaExec: Sandbox["exec"] = ({ command, argv: args = [] }) => {
  if (command !== "git") {
    return Effect.succeed({
      exitCode: 1,
      stdout: "",
      stderr: `unexpected ${command}`,
    });
  }
  if (args[0] === "status") {
    return Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
  }
  if (args[0] === "merge-base") {
    return Effect.succeed({ exitCode: 0, stdout: "abc123\n", stderr: "" });
  }
  if (args[0] === "diff") {
    return Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
  }
  return Effect.succeed({
    exitCode: 1,
    stdout: "",
    stderr: `unexpected git ${args.join(" ")}`,
  });
};

describe("runSeamConfirmAgent", () => {
  it.effect(
    "confirms when pending delta is empty and output has TDD seam-wait markers",
    () =>
      Effect.gen(function* () {
        const result = yield* runSeamConfirmAgent({
          sandbox: sandboxWith(emptyDeltaExec),
          output:
            "Per /tdd, seams need your OK before any test.\nProposed seams:\n1. AgentRunOptions",
          seamConfirmCount: 0,
          buildAttempts: 1,
          reviewAttempts: 0,
        });
        assert.strictEqual(result.outcome, SeamConfirmOutcome.Confirm);
      })
  );

  it.effect("skips when worktree is dirty even with seam markers", () =>
    Effect.gen(function* () {
      const result = yield* runSeamConfirmAgent({
        sandbox: sandboxWith(({ command, argv: args = [] }) => {
          if (command === "git" && args[0] === "status") {
            return Effect.succeed({
              exitCode: 0,
              stdout: " M packages/runtime/src/agent-provider.ts\n",
              stderr: "",
            });
          }
          return emptyDeltaExec({ command, argv: args });
        }),
        output: "seams need your OK before any test",
        seamConfirmCount: 0,
        buildAttempts: 1,
        reviewAttempts: 0,
      });
      assert.strictEqual(result.outcome, SeamConfirmOutcome.Skip);
    })
  );

  it.effect(
    "skips when branch has commits vs merge-base even with markers",
    () =>
      Effect.gen(function* () {
        const result = yield* runSeamConfirmAgent({
          sandbox: sandboxWith(({ command, argv: args = [] }) => {
            if (command === "git" && args[0] === "diff") {
              return Effect.succeed({
                exitCode: 0,
                stdout: "diff --git a/x b/x\n+hello\n",
                stderr: "",
              });
            }
            return emptyDeltaExec({ command, argv: args });
          }),
          output: "seams need your OK before any test",
          seamConfirmCount: 0,
          buildAttempts: 1,
          reviewAttempts: 0,
        });
        assert.strictEqual(result.outcome, SeamConfirmOutcome.Skip);
      })
  );

  it.effect("skips empty delta when output has no seam-wait markers", () =>
    Effect.gen(function* () {
      const result = yield* runSeamConfirmAgent({
        sandbox: sandboxWith(emptyDeltaExec),
        output: "Implemented the ticket. Tests pass.",
        seamConfirmCount: 0,
        buildAttempts: 1,
        reviewAttempts: 0,
      });
      assert.strictEqual(result.outcome, SeamConfirmOutcome.Skip);
    })
  );

  it.effect("skips 'before any test' without a seam word", () =>
    Effect.gen(function* () {
      const result = yield* runSeamConfirmAgent({
        sandbox: sandboxWith(emptyDeltaExec),
        output: "Need your OK before any test.",
        seamConfirmCount: 0,
        buildAttempts: 1,
        reviewAttempts: 0,
      });
      assert.strictEqual(result.outcome, SeamConfirmOutcome.Skip);
    })
  );

  it.effect("skips 'seamless' without a seam word boundary", () =>
    Effect.gen(function* () {
      const result = yield* runSeamConfirmAgent({
        sandbox: sandboxWith(emptyDeltaExec),
        output: "Keep the fallback seamless for empty catalog.",
        seamConfirmCount: 0,
        buildAttempts: 1,
        reviewAttempts: 0,
      });
      assert.strictEqual(result.outcome, SeamConfirmOutcome.Skip);
    })
  );

  it.effect("skips when seamConfirmCount already used the cap", () =>
    Effect.gen(function* () {
      const result = yield* runSeamConfirmAgent({
        sandbox: sandboxWith(emptyDeltaExec),
        output: "seams need your OK before any test",
        seamConfirmCount: 1,
        buildAttempts: 1,
        reviewAttempts: 0,
      });
      assert.strictEqual(result.outcome, SeamConfirmOutcome.Skip);
    })
  );

  it.effect("skips when git status exec fails", () =>
    Effect.gen(function* () {
      const result = yield* runSeamConfirmAgent({
        sandbox: sandboxWith(() =>
          Effect.fail(new SandboxExecError({ message: "git missing" }))
        ),
        output: "seams need your OK before any test",
        seamConfirmCount: 0,
        buildAttempts: 1,
        reviewAttempts: 0,
      });
      assert.strictEqual(result.outcome, SeamConfirmOutcome.Skip);
    })
  );

  it.effect("reads seam markers from JSON session output", () =>
    Effect.gen(function* () {
      const result = yield* runSeamConfirmAgent({
        sandbox: sandboxWith(emptyDeltaExec),
        output: {
          note: "seams need your OK before any test",
        },
        seamConfirmCount: 0,
        buildAttempts: 1,
        reviewAttempts: 0,
      });
      assert.strictEqual(result.outcome, SeamConfirmOutcome.Confirm);
    })
  );

  it.effect("emits seam_confirm enter and resume on confirm", () =>
    Effect.gen(function* () {
      const lines: string[] = [];
      yield* runSeamConfirmAgent({
        sandbox: sandboxWith(emptyDeltaExec),
        output: "seams need your OK before any test",
        seamConfirmCount: 0,
        buildAttempts: 1,
        reviewAttempts: 0,
      }).pipe(Effect.provide(Logger.layer([captureAdwProgressLogger(lines)])));

      assert.isTrue(
        lines.some(
          (l) => l.includes("step_enter") && l.includes("seam_confirm")
        )
      );
      assert.isTrue(
        lines.some(
          (l) =>
            l.includes("step_result") &&
            l.includes("seam_confirm") &&
            l.includes("result=resume")
        )
      );
    })
  );
});
