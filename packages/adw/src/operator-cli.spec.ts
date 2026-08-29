import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Stdio, Terminal } from "effect";
import { TestConsole } from "effect/testing";
import { ChildProcessSpawner } from "effect/unstable/process";
import {
  AdwSandboxProviderKind,
  operatorCliConfigLayer,
  operatorFlagsFromCli,
  runOperatorArgv,
  selectDockerWorkerEnv,
} from "./operator-cli.ts";
import { stripPnpmLeadingDashDash } from "./host-operator-cli.ts";
import { hostOperatorFsLayer } from "./host-operator.ts";
import { TicketIntake, TicketIntakeError } from "./ticket-intake.ts";
import { Option } from "effect";

const OperatorCliTestLayer = Layer.mergeAll(
  hostOperatorFsLayer,
  Stdio.layerTest({}),
  Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      readInput: Effect.die("unused"),
      readLine: Effect.die("unused"),
      display: () => Effect.void,
    })
  ),
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("unused"))
  ),
  TestConsole.layer,
  operatorCliConfigLayer,
  Layer.succeed(
    TicketIntake,
    TicketIntake.of({
      loadReadyTicket: () =>
        Effect.fail(new TicketIntakeError({ message: "unused" })),
    })
  )
);

describe("generic adw CLI", () => {
  it("defaults sandbox to host without changing Host default", () => {
    const flags = operatorFlagsFromCli({
      sandbox: AdwSandboxProviderKind.Host,
      issue: Option.none(),
      ticket: Option.some("84"),
      prompt: Option.some("ship it"),
      repoUrl: Option.none(),
      startingRef: Option.none(),
      cwd: Option.none(),
    });
    assert.strictEqual(flags.sandbox, AdwSandboxProviderKind.Host);
  });

  it.effect("rejects docker with --cwd", () =>
    Effect.gen(function* () {
      const code = yield* runOperatorArgv([
        "--sandbox",
        "docker",
        "--ticket",
        "84",
        "--prompt",
        "x",
        "--repo-url",
        "https://example.test/r.git",
        "--cwd",
        "/tmp/nope",
      ]).pipe(Effect.provide(OperatorCliTestLayer));
      assert.strictEqual(code, 1);
    })
  );

  it.effect("rejects docker without --repo-url", () =>
    Effect.gen(function* () {
      const prev = process.env["ADW_REPO_URL"];
      delete process.env["ADW_REPO_URL"];
      const code = yield* runOperatorArgv([
        "--sandbox",
        "docker",
        "--ticket",
        "84",
        "--prompt",
        "x",
      ]).pipe(Effect.provide(OperatorCliTestLayer));
      if (prev !== undefined) {
        process.env["ADW_REPO_URL"] = prev;
      }
      assert.strictEqual(code, 1);
    })
  );

  it("stripPnpmLeadingDashDash removes pnpm separator", () => {
    assert.deepStrictEqual(stripPnpmLeadingDashDash(["--", "--issue", "1"]), [
      "--issue",
      "1",
    ]);
  });

  it("passes only explicit worker credentials and settings into Docker", () => {
    assert.deepStrictEqual(
      selectDockerWorkerEnv({
        CURSOR_API_KEY: "cursor-key",
        GH_TOKEN: "github-token",
        ADW_MODEL: "grok-4.5",
        HOME: "/home/operator",
        PNPM_HOME: "/home/operator/.local/share/pnpm",
        AWS_SECRET_ACCESS_KEY: "unrelated-secret",
      }),
      {
        CURSOR_API_KEY: "cursor-key",
        GH_TOKEN: "github-token",
        ADW_MODEL: "grok-4.5",
      }
    );
  });
});
