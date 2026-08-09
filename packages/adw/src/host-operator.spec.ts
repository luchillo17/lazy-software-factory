import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { AdwStatus } from "./enums.ts";
import {
  exitCodeForStatus,
  formatOperatorResult,
  parseHostOperatorArgs,
  redactSecrets,
} from "./host-operator.ts";

describe("host operator entry", () => {
  it("parseHostOperatorArgs reads flags", () => {
    const parsed = parseHostOperatorArgs([
      "--ticket",
      "T-1",
      "--prompt",
      "do the thing",
      "--repo-url",
      "https://example.test/r.git",
    ]);
    assert.deepStrictEqual(parsed, {
      ticketId: "T-1",
      prompt: "do the thing",
      repoUrl: "https://example.test/r.git",
    });
  });

  it("parseHostOperatorArgs errors without ticket/prompt", () => {
    const parsed = parseHostOperatorArgs([]);
    assert.isTrue("error" in parsed);
  });

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
    const parsed = parseHostOperatorArgs([
      "--",
      "--ticket",
      "T-1",
      "--prompt",
      "do the thing",
    ]);
    assert.deepStrictEqual(parsed, {
      ticketId: "T-1",
      prompt: "do the thing",
    });
  });

  it("parseHostOperatorArgs accepts equals-form flags", () => {
    const parsed = parseHostOperatorArgs([
      "--ticket=T-9",
      "--prompt=do it",
      "--repo-url=https://example.test/r.git",
    ]);
    assert.deepStrictEqual(parsed, {
      ticketId: "T-9",
      prompt: "do it",
      repoUrl: "https://example.test/r.git",
    });
  });

  it("parseHostOperatorArgs falls back to Config env", () => {
    const prevTicket = process.env["ADW_TICKET_ID"];
    const prevPrompt = process.env["ADW_PROMPT"];
    process.env["ADW_TICKET_ID"] = "T-ENV";
    process.env["ADW_PROMPT"] = "from env";
    try {
      const parsed = parseHostOperatorArgs([]);
      assert.deepStrictEqual(parsed, {
        ticketId: "T-ENV",
        prompt: "from env",
      });
    } finally {
      if (prevTicket === undefined) {
        delete process.env["ADW_TICKET_ID"];
      } else {
        process.env["ADW_TICKET_ID"] = prevTicket;
      }
      if (prevPrompt === undefined) {
        delete process.env["ADW_PROMPT"];
      } else {
        process.env["ADW_PROMPT"] = prevPrompt;
      }
    }
  });

  it("redactSecrets strips token-like substrings from detail", () => {
    const redacted = redactSecrets(
      "push failed GH_TOKEN=gho_abcdefghijklmnopqrstuv stderr"
    );
    assert.isFalse(redacted.includes("gho_"));
    assert.isTrue(redacted.includes("[REDACTED]"));
  });
});
