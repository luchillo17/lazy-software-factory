import type { Sandbox } from "@lazy-software-factory/runtime";
import { Effect } from "effect";

/**
 * Test helper: pending-delta git probes succeed with an empty delta.
 * Other sandbox.exec calls go to `fallback` (Test gates, provision, …).
 */
export const withEmptyPendingDeltaGit =
  (fallback: Sandbox["exec"]): Sandbox["exec"] =>
  (options) => {
    const { command, argv: args = [] } = options;
    if (command === "git" && args[0] === "status") {
      return Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
    }
    if (command === "git" && args[0] === "merge-base") {
      return Effect.succeed({
        exitCode: 0,
        stdout: "abc123\n",
        stderr: "",
      });
    }
    if (command === "git" && args[0] === "diff") {
      return Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
    }
    return fallback(options);
  };
