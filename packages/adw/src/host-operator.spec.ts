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
  hostOperatorArgsFromFlags,
  hostOperatorFsLayer,
  HostOperatorParseError,
  loadHostDotEnv,
  mergeHostOperatorEnv,
  prepareAdwHostArgv,
  prepareHostOperatorSession,
  redactSecrets,
  resolveHostOperatorAdwInput,
  resolveHostOperatorCwd,
} from "./host-operator.ts";
import { TicketIntake } from "./ticket-intake.ts";

const emptyEnv = {};

describe("host operator entry", () => {
  it("hostOperatorArgsFromFlags reads flags", () => {
    const parsed = hostOperatorArgsFromFlags(
      {
        ticket: "T-1",
        prompt: "do the thing",
        repoUrl: "https://example.test/r.git",
      },
      emptyEnv
    );
    assert.deepStrictEqual(parsed, {
      ticketId: "T-1",
      prompt: "do the thing",
      repoUrl: "https://example.test/r.git",
    });
  });

  it("hostOperatorArgsFromFlags errors without ticket/prompt or issue", () => {
    const parsed = hostOperatorArgsFromFlags({}, emptyEnv);
    assert.isTrue("error" in parsed);
  });

  it("hostOperatorArgsFromFlags accepts Issue ref", () => {
    const parsed = hostOperatorArgsFromFlags(
      {
        issue: "37",
        repoUrl: "https://example.test/r.git",
      },
      emptyEnv
    );
    assert.deepStrictEqual(parsed, {
      issueRef: "37",
      repoUrl: "https://example.test/r.git",
    });
  });

  it("hostOperatorArgsFromFlags rejects mixing --issue with --ticket/--prompt", () => {
    const parsed = hostOperatorArgsFromFlags(
      {
        issue: "37",
        ticket: "T-1",
        prompt: "x",
      },
      emptyEnv
    );
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

  it("hostOperatorArgsFromFlags falls back to Config env", () => {
    const parsed = hostOperatorArgsFromFlags(
      {},
      {
        ADW_TICKET_ID: "T-ENV",
        ADW_PROMPT: "from env",
      }
    );
    assert.deepStrictEqual(parsed, {
      ticketId: "T-ENV",
      prompt: "from env",
    });
  });

  it("hostOperatorArgsFromFlags accepts cwd flag", () => {
    const parsed = hostOperatorArgsFromFlags(
      {
        ticket: "T-1",
        prompt: "do the thing",
        cwd: "/tmp/target-tree",
      },
      emptyEnv
    );
    assert.deepStrictEqual(parsed, {
      ticketId: "T-1",
      prompt: "do the thing",
      cwd: "/tmp/target-tree",
    });
  });

  it("hostOperatorArgsFromFlags falls back to ADW_CWD", () => {
    const parsed = hostOperatorArgsFromFlags(
      {},
      {
        ADW_CWD: "/tmp/from-env",
        ADW_TICKET_ID: "T-ENV",
        ADW_PROMPT: "from env",
      }
    );
    assert.deepStrictEqual(parsed, {
      ticketId: "T-ENV",
      prompt: "from env",
      cwd: "/tmp/from-env",
    });
  });

  it("hostOperatorArgsFromFlags keeps --issue vs --ticket/--prompt exclusivity with cwd", () => {
    const parsed = hostOperatorArgsFromFlags(
      {
        issue: "37",
        ticket: "T-1",
        prompt: "x",
        cwd: "/tmp/tree",
      },
      emptyEnv
    );
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

  it.effect("prepareHostOperatorSession fills ADW_ISSUE from <cwd>/.env", () =>
    Effect.gen(function* () {
      const dir = mkdtempSync(join(tmpdir(), "adw-session-"));
      writeFileSync(join(dir, ".env"), "ADW_ISSUE=99\n");
      try {
        const session = yield* prepareHostOperatorSession(
          { cwd: dir },
          emptyEnv
        ).pipe(Effect.provide(hostOperatorFsLayer));
        assert.strictEqual(
          "issueRef" in session.args ? session.args.issueRef : undefined,
          "99"
        );
        assert.strictEqual(session.args.cwd, dir);
        assert.strictEqual(session.env["ADW_ISSUE"], "99");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    })
  );

  it.effect(
    "prepareHostOperatorSession fails closed when flags and env are empty",
    () =>
      Effect.gen(function* () {
        const result = yield* prepareHostOperatorSession({}, emptyEnv).pipe(
          Effect.provide(hostOperatorFsLayer),
          Effect.result
        );
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.isTrue(result.failure instanceof HostOperatorParseError);
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

  it("prepareAdwHostArgv injects invoker cwd when --cwd and ADW_CWD are absent", () => {
    assert.deepStrictEqual(
      prepareAdwHostArgv(["--issue", "68"], "/tmp/sibling-repo", {}),
      ["--cwd", "/tmp/sibling-repo", "--issue", "68"]
    );
  });

  it("prepareAdwHostArgv leaves argv alone when --cwd is present", () => {
    assert.deepStrictEqual(
      prepareAdwHostArgv(
        ["--issue", "68", "--cwd", "/tmp/explicit"],
        "/tmp/sibling-repo",
        {}
      ),
      ["--issue", "68", "--cwd", "/tmp/explicit"]
    );
  });

  it("prepareAdwHostArgv leaves argv alone when ADW_CWD is set", () => {
    assert.deepStrictEqual(
      prepareAdwHostArgv(["--issue", "68"], "/tmp/sibling-repo", {
        ADW_CWD: "/tmp/from-env",
      }),
      ["--issue", "68"]
    );
  });

  it("prepareAdwHostArgv preserves leading pnpm --", () => {
    assert.deepStrictEqual(
      prepareAdwHostArgv(
        ["--", "--ticket", "T-1", "--prompt", "x"],
        "/inv",
        {}
      ),
      ["--", "--cwd", "/inv", "--ticket", "T-1", "--prompt", "x"]
    );
  });

  it("redactSecrets strips token-like substrings from detail", () => {
    const redacted = redactSecrets(
      "push failed GH_TOKEN=gho_abcdefghijklmnopqrstuv stderr"
    );
    assert.isFalse(redacted.includes("gho_"));
    assert.isTrue(redacted.includes("[REDACTED]"));
  });
});
