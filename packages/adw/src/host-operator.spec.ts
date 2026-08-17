import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdwStatus } from "./enums.ts";
import {
  exitCodeForStatus,
  formatOperatorResult,
  HostCwdError,
  hostOperatorFsLayer,
  loadHostDotEnv,
  mergeHostOperatorEnv,
  parseHostOperatorArgs,
  redactSecrets,
  resolveHostOperatorAdwInput,
  resolveHostOperatorCwd,
} from "./host-operator.ts";
import { TicketIntake } from "./ticket-intake.ts";

const ADW_ENV_KEYS = [
  "ADW_TICKET_ID",
  "ADW_PROMPT",
  "ADW_ISSUE",
  "ADW_REPO_URL",
  "ADW_CWD",
] as const;

/** Clear Host CLI env fallbacks for isolated parse tests. */
const withClearedAdwEnv = <T>(fn: () => T): T => {
  const previous = new Map(
    ADW_ENV_KEYS.map((key) => [key, process.env[key]] as const)
  );
  for (const key of ADW_ENV_KEYS) {
    delete process.env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of ADW_ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

describe("host operator entry", () => {
  it("parseHostOperatorArgs reads flags", () => {
    const parsed = withClearedAdwEnv(() =>
      parseHostOperatorArgs([
        "--ticket",
        "T-1",
        "--prompt",
        "do the thing",
        "--repo-url",
        "https://example.test/r.git",
      ])
    );
    assert.deepStrictEqual(parsed, {
      ticketId: "T-1",
      prompt: "do the thing",
      repoUrl: "https://example.test/r.git",
    });
  });

  it("parseHostOperatorArgs errors without ticket/prompt or issue", () => {
    const parsed = withClearedAdwEnv(() => parseHostOperatorArgs([]));
    assert.isTrue("error" in parsed);
  });

  it("parseHostOperatorArgs accepts Issue ref", () => {
    const parsed = withClearedAdwEnv(() =>
      parseHostOperatorArgs([
        "--issue",
        "37",
        "--repo-url",
        "https://example.test/r.git",
      ])
    );
    assert.deepStrictEqual(parsed, {
      issueRef: "37",
      repoUrl: "https://example.test/r.git",
    });
  });

  it("parseHostOperatorArgs rejects mixing --issue with --ticket/--prompt", () => {
    const parsed = parseHostOperatorArgs([
      "--issue",
      "37",
      "--ticket",
      "T-1",
      "--prompt",
      "x",
    ]);
    assert.isTrue("error" in parsed);
  });

  it.effect(
    "resolveHostOperatorAdwInput feeds runMinimalAdw shape from intake",
    () =>
      Effect.gen(function* () {
        const fakeIntake = Layer.succeed(
          TicketIntake,
          TicketIntake.of({
            loadReadyTicket: (ref) =>
              Effect.succeed({
                ticketId: ref,
                prompt: `# Issue ${ref}\n\nbody`,
              }),
          })
        );

        const input = yield* resolveHostOperatorAdwInput({
          issueRef: "37",
          repoUrl: "https://example.test/r.git",
        }).pipe(Effect.provide(fakeIntake));

        assert.deepStrictEqual(input, {
          ticketId: "37",
          prompt: "# Issue 37\n\nbody",
          repoUrl: "https://example.test/r.git",
        });
      })
  );

  it.effect(
    "resolveHostOperatorAdwInput passes through manual ticket/prompt",
    () =>
      Effect.gen(function* () {
        const input = yield* resolveHostOperatorAdwInput({
          ticketId: "T-1",
          prompt: "do the thing",
        });
        assert.deepStrictEqual(input, {
          ticketId: "T-1",
          prompt: "do the thing",
        });
      })
  );

  it.effect(
    "formatOperatorResult surfaces status without inventing secrets",
    () =>
      Effect.sync(() => {
        const line = formatOperatorResult({
          ticketId: "T-1",
          status: AdwStatus.Shipped,
          prUrl: "https://example.test/pr/1",
          sandboxId: "sbx",
        });
        assert.strictEqual(
          line,
          "status=shipped ticket=T-1 pr=https://example.test/pr/1 sandbox=sbx"
        );
        assert.isFalse(line.toLowerCase().includes("token"));
        assert.isFalse(line.toLowerCase().includes("api_key"));
      })
  );

  it("exitCodeForStatus maps outcomes", () => {
    assert.strictEqual(exitCodeForStatus(AdwStatus.Shipped), 0);
    assert.strictEqual(exitCodeForStatus(AdwStatus.ReadyForPr), 2);
    assert.strictEqual(exitCodeForStatus(AdwStatus.Failed), 1);
  });

  it("parseHostOperatorArgs rejects flag-as-value", () => {
    const parsed = parseHostOperatorArgs(["--ticket", "--prompt", "x"]);
    assert.isTrue("error" in parsed);
  });

  it("parseHostOperatorArgs strips leading -- from pnpm", () => {
    const parsed = withClearedAdwEnv(() =>
      parseHostOperatorArgs([
        "--",
        "--ticket",
        "T-1",
        "--prompt",
        "do the thing",
      ])
    );
    assert.deepStrictEqual(parsed, {
      ticketId: "T-1",
      prompt: "do the thing",
    });
  });

  it("parseHostOperatorArgs accepts equals-form flags", () => {
    const parsed = withClearedAdwEnv(() =>
      parseHostOperatorArgs([
        "--ticket=T-9",
        "--prompt=do it",
        "--repo-url=https://example.test/r.git",
      ])
    );
    assert.deepStrictEqual(parsed, {
      ticketId: "T-9",
      prompt: "do it",
      repoUrl: "https://example.test/r.git",
    });
  });

  it("parseHostOperatorArgs falls back to Config env", () => {
    const parsed = withClearedAdwEnv(() => {
      process.env["ADW_TICKET_ID"] = "T-ENV";
      process.env["ADW_PROMPT"] = "from env";
      return parseHostOperatorArgs([]);
    });
    assert.deepStrictEqual(parsed, {
      ticketId: "T-ENV",
      prompt: "from env",
    });
  });

  it("parseHostOperatorArgs accepts --cwd", () => {
    const parsed = withClearedAdwEnv(() =>
      parseHostOperatorArgs([
        "--ticket",
        "T-1",
        "--prompt",
        "do the thing",
        "--cwd",
        "/tmp/target-tree",
      ])
    );
    assert.deepStrictEqual(parsed, {
      ticketId: "T-1",
      prompt: "do the thing",
      cwd: "/tmp/target-tree",
    });
  });

  it("parseHostOperatorArgs falls back to ADW_CWD", () => {
    const parsed = withClearedAdwEnv(() => {
      process.env["ADW_CWD"] = "/tmp/from-env";
      process.env["ADW_TICKET_ID"] = "T-ENV";
      process.env["ADW_PROMPT"] = "from env";
      return parseHostOperatorArgs([]);
    });
    assert.deepStrictEqual(parsed, {
      ticketId: "T-ENV",
      prompt: "from env",
      cwd: "/tmp/from-env",
    });
  });

  it("parseHostOperatorArgs keeps --issue vs --ticket/--prompt exclusivity with --cwd", () => {
    const parsed = parseHostOperatorArgs([
      "--issue",
      "37",
      "--ticket",
      "T-1",
      "--prompt",
      "x",
      "--cwd",
      "/tmp/tree",
    ]);
    assert.isTrue("error" in parsed);
  });

  it.effect("resolveHostOperatorCwd defaults to process.cwd when omitted", () =>
    resolveHostOperatorCwd(undefined).pipe(
      Effect.provide(hostOperatorFsLayer),
      Effect.map((resolved) => {
        assert.strictEqual(resolved, process.cwd());
      })
    )
  );

  it.effect("resolveHostOperatorCwd resolves an existing directory", () =>
    Effect.gen(function* () {
      const dir = mkdtempSync(join(tmpdir(), "adw-cwd-"));
      try {
        const resolved = yield* resolveHostOperatorCwd(dir).pipe(
          Effect.provide(hostOperatorFsLayer)
        );
        assert.strictEqual(resolved, dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    })
  );

  it.effect("resolveHostOperatorCwd fails closed for missing path", () =>
    Effect.gen(function* () {
      const result = yield* resolveHostOperatorCwd(
        join(tmpdir(), "adw-cwd-missing-nope")
      ).pipe(Effect.provide(hostOperatorFsLayer), Effect.result);
      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.isTrue(result.failure instanceof HostCwdError);
        assert.isTrue(result.failure.message.includes("does not exist"));
      }
    })
  );

  it.effect("resolveHostOperatorCwd fails closed when path is a file", () =>
    Effect.gen(function* () {
      const dir = mkdtempSync(join(tmpdir(), "adw-cwd-"));
      const file = join(dir, "not-a-dir");
      writeFileSync(file, "x");
      try {
        const result = yield* resolveHostOperatorCwd(file).pipe(
          Effect.provide(hostOperatorFsLayer),
          Effect.result
        );
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.isTrue(result.failure instanceof HostCwdError);
          assert.isTrue(result.failure.message.includes("not a directory"));
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    })
  );

  it.effect("loadHostDotEnv reads keys from <cwd>/.env", () =>
    Effect.gen(function* () {
      const dir = mkdtempSync(join(tmpdir(), "adw-env-"));
      writeFileSync(join(dir, ".env"), "ADW_ISSUE=99\nGH_TOKEN=from-file\n");
      try {
        const fileEnv = yield* loadHostDotEnv(dir).pipe(
          Effect.provide(hostOperatorFsLayer)
        );
        assert.strictEqual(fileEnv["ADW_ISSUE"], "99");
        assert.strictEqual(fileEnv["GH_TOKEN"], "from-file");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    })
  );

  it.effect("loadHostDotEnv is empty when .env is missing", () =>
    Effect.gen(function* () {
      const dir = mkdtempSync(join(tmpdir(), "adw-env-missing-"));
      try {
        const fileEnv = yield* loadHostDotEnv(dir).pipe(
          Effect.provide(hostOperatorFsLayer)
        );
        assert.deepStrictEqual(fileEnv, {});
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    })
  );

  it("mergeHostOperatorEnv lets shell env win over file keys", () => {
    const merged = mergeHostOperatorEnv(
      { GH_TOKEN: "from-file", ADW_ISSUE: "1" },
      { GH_TOKEN: "from-shell" }
    );
    assert.strictEqual(merged["GH_TOKEN"], "from-shell");
    assert.strictEqual(merged["ADW_ISSUE"], "1");
  });

  it("redactSecrets strips token-like substrings from detail", () => {
    const redacted = redactSecrets(
      "push failed GH_TOKEN=gho_abcdefghijklmnopqrstuv stderr"
    );
    assert.isFalse(redacted.includes("gho_"));
    assert.isTrue(redacted.includes("[REDACTED]"));
  });
});
