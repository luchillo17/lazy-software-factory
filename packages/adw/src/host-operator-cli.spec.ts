import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Stdio, Terminal } from "effect";
import { TestConsole } from "effect/testing";
import { ChildProcessSpawner } from "effect/unstable/process";
import {
  hostOperatorCliConfigLayer,
  parseHostOperatorCliFlags,
  runHostOperatorArgv,
  stripPnpmLeadingDashDash,
} from "./host-operator-cli.ts";
import {
  hostOperatorArgsFromFlags,
  hostOperatorFsLayer,
} from "./host-operator.ts";
import { TicketIntake, TicketIntakeError } from "./ticket-intake.ts";

const HostCliTestLayer = Layer.mergeAll(
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
  hostOperatorCliConfigLayer,
  Layer.succeed(
    TicketIntake,
    TicketIntake.of({
      loadReadyTicket: () =>
        Effect.fail(new TicketIntakeError({ message: "unused" })),
    })
  )
);

const emptyEnv = {};

const ADW_ENV_KEYS = [
  "ADW_TICKET_ID",
  "ADW_PROMPT",
  "ADW_ISSUE",
  "ADW_REPO_URL",
  "ADW_CWD",
] as const;

const withClearedAdwEnv = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previous = new Map(
        ADW_ENV_KEYS.map((key) => [key, process.env[key]] as const)
      );
      for (const key of ADW_ENV_KEYS) {
        delete process.env[key];
      }
      return previous;
    }),
    (previous) =>
      Effect.sync(() => {
        for (const key of ADW_ENV_KEYS) {
          const value = previous.get(key);
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      })
  ).pipe(
    Effect.andThen(() => effect),
    Effect.scoped
  );

describe("host operator Effect CLI", () => {
  it("stripPnpmLeadingDashDash drops a leading --", () => {
    assert.deepStrictEqual(stripPnpmLeadingDashDash(["--", "--issue", "37"]), [
      "--issue",
      "37",
    ]);
  });

  it.effect("parseHostOperatorCliFlags reads flags", () =>
    Effect.gen(function* () {
      const flags = yield* parseHostOperatorCliFlags([
        "--ticket",
        "T-1",
        "--prompt",
        "do the thing",
        "--repo-url",
        "https://example.test/r.git",
      ]).pipe(Effect.provide(HostCliTestLayer));
      assert.deepStrictEqual(hostOperatorArgsFromFlags(flags, emptyEnv), {
        ticketId: "T-1",
        prompt: "do the thing",
        repoUrl: "https://example.test/r.git",
      });
    })
  );

  it.effect("parseHostOperatorCliFlags strips leading pnpm --", () =>
    Effect.gen(function* () {
      const flags = yield* parseHostOperatorCliFlags([
        "--",
        "--ticket",
        "T-1",
        "--prompt",
        "do the thing",
      ]).pipe(Effect.provide(HostCliTestLayer));
      assert.deepStrictEqual(hostOperatorArgsFromFlags(flags, emptyEnv), {
        ticketId: "T-1",
        prompt: "do the thing",
      });
    })
  );

  it.effect("parseHostOperatorCliFlags accepts equals-form flags", () =>
    Effect.gen(function* () {
      const flags = yield* parseHostOperatorCliFlags([
        "--ticket=T-9",
        "--prompt=do it",
        "--repo-url=https://example.test/r.git",
      ]).pipe(Effect.provide(HostCliTestLayer));
      assert.deepStrictEqual(hostOperatorArgsFromFlags(flags, emptyEnv), {
        ticketId: "T-9",
        prompt: "do it",
        repoUrl: "https://example.test/r.git",
      });
    })
  );

  it.effect("parseHostOperatorCliFlags rejects flag-as-value", () =>
    Effect.gen(function* () {
      const result = yield* parseHostOperatorCliFlags([
        "--ticket",
        "--prompt",
        "x",
      ]).pipe(Effect.provide(HostCliTestLayer), Effect.result);
      assert.strictEqual(result._tag, "Failure");
    })
  );

  it.effect("runHostOperatorArgv --help exits 0 and names the Footgun", () =>
    Effect.gen(function* () {
      const code = yield* runHostOperatorArgv(["--help"]).pipe(
        Effect.provide(HostCliTestLayer)
      );
      assert.strictEqual(code, 0);
      const lines = yield* TestConsole.logLines;
      const help = lines.map(String).join("\n");
      assert.isTrue(help.includes("Footgun"));
      assert.isTrue(help.includes("--cwd"));
      assert.isTrue(help.includes("adw-host"));
    })
  );

  it.effect("runHostOperatorArgv missing issue/ticket exits 1", () =>
    withClearedAdwEnv(
      Effect.gen(function* () {
        const code = yield* runHostOperatorArgv([]).pipe(
          Effect.provide(HostCliTestLayer)
        );
        assert.strictEqual(code, 1);
      })
    )
  );
});
