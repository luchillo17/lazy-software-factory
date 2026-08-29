import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Stdio, Terminal } from "effect";
import { TestConsole } from "effect/testing";
import { ChildProcessSpawner } from "effect/unstable/process";
import {
  AdwWorkerAdwStatus,
  AdwWorkerCapability,
  AdwWorkerIsolation,
  AdwWorkerTerminalKind,
} from "@lazy-software-factory/adw-worker";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AdwSandboxProviderKind,
  formatDockerOperatorResult,
  operatorCliConfigLayer,
  operatorFlagsFromCli,
  prepareDockerOperatorSession,
  runOperatorArgv,
  selectDockerWorkerEnv,
} from "./operator-cli.ts";
import { resolveAdwRunnerImage } from "./docker-runner-image.ts";
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
  it("maps explicit --sandbox host through operatorFlagsFromCli", () => {
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

  it.effect(
    "defaults sandbox to docker (requires --repo-url without --sandbox)",
    () =>
      Effect.gen(function* () {
        const prev = process.env["ADW_REPO_URL"];
        delete process.env["ADW_REPO_URL"];
        const code = yield* runOperatorArgv([
          "--ticket",
          "86",
          "--prompt",
          "x",
        ]).pipe(Effect.provide(OperatorCliTestLayer));
        if (prev !== undefined) {
          process.env["ADW_REPO_URL"] = prev;
        }
        assert.strictEqual(code, 1);
        const errors = yield* TestConsole.errorLines;
        assert.isTrue(
          errors.some(
            (line) =>
              typeof line === "string" &&
              line.includes("Docker sandbox requires --repo-url")
          )
        );
      })
  );

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

  it.effect("help documents docker as default and host as explicit", () =>
    Effect.gen(function* () {
      const code = yield* runOperatorArgv(["--help"]).pipe(
        Effect.provide(OperatorCliTestLayer)
      );
      assert.strictEqual(code, 0);
      const help = (yield* TestConsole.logLines).map(String).join("\n");
      assert.isTrue(help.includes("Default: docker"));
      assert.isTrue(help.includes("--sandbox host"));
      assert.isTrue(help.includes("adw-host"));
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

  it("formats Docker lease, sessions, image, and capabilities", () => {
    const effectiveCapabilities = {
      capabilities: [AdwWorkerCapability.CursorLocalAgent],
      maxConcurrentLeases: 32,
      isolation: AdwWorkerIsolation.Container,
    };
    const result = {
      ticketId: "86",
      status: AdwWorkerAdwStatus.Shipped,
      sandboxId: "docker-lease-1",
      buildSessionId: "build-1",
      reviewSessionId: "review-1",
      prUrl: "https://example.test/pr/1",
    };
    const line = formatDockerOperatorResult(
      {
        outcome: {
          kind: AdwWorkerTerminalKind.Completed,
          result,
          effectiveCapabilities,
        },
        result,
        effectiveCapabilities,
      },
      "example.test/adw:proof"
    );
    assert.include(line, "sandbox=docker-lease-1");
    assert.include(line, "buildSession=build-1");
    assert.include(line, "reviewSession=review-1");
    assert.include(line, "terminal=completed");
    assert.include(line, "image=example.test/adw:proof");
    assert.include(line, '"isolation":"container"');
  });

  it.effect("loads Docker URL and image override from operator .env", () => {
    const dir = mkdtempSync(join(tmpdir(), "adw-docker-env-"));
    writeFileSync(
      join(dir, ".env"),
      [
        "ADW_REPO_URL=https://example.test/from-dotenv.git",
        "ADW_RUNNER_IMAGE=example.test/adw:proof",
      ].join("\n")
    );

    return Effect.gen(function* () {
      const session = yield* prepareDockerOperatorSession(
        { ticket: "86", prompt: "x" },
        dir,
        {}
      );
      assert.strictEqual(
        session.args.repoUrl,
        "https://example.test/from-dotenv.git"
      );
      assert.strictEqual(
        resolveAdwRunnerImage(session.env),
        "example.test/adw:proof"
      );
    }).pipe(
      Effect.provide(hostOperatorFsLayer),
      Effect.ensuring(Effect.sync(() => rmSync(dir, { recursive: true })))
    );
  });

  it.effect("rejects ADW_CWD loaded from operator .env", () => {
    const dir = mkdtempSync(join(tmpdir(), "adw-docker-cwd-"));
    writeFileSync(join(dir, ".env"), "ADW_CWD=/tmp/host-only\n");

    return prepareDockerOperatorSession(
      { ticket: "86", prompt: "x" },
      dir,
      {}
    ).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => {
          assert.include(error.message, "Docker sandbox rejects");
        })
      ),
      Effect.asVoid,
      Effect.provide(hostOperatorFsLayer),
      Effect.ensuring(Effect.sync(() => rmSync(dir, { recursive: true })))
    );
  });
});
