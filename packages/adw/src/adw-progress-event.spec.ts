import { assert, describe, it } from "@effect/vitest";
import {
  AdwProgressKind,
  AdwStep,
  AdwStepResult,
  DEFAULT_PROGRESS_RAW_MAX,
  formatAdwProgressEvent,
  truncateProgressRaw,
} from "./adw-progress-event.ts";

describe("formatAdwProgressEvent", () => {
  it("formats step_enter with attempt counters", () => {
    const line = formatAdwProgressEvent({
      kind: AdwProgressKind.StepEnter,
      step: AdwStep.Review,
      buildAttempts: 1,
      reviewAttempts: 0,
    });
    assert.strictEqual(
      line,
      "adw kind=step_enter step=review buildAttempts=1 reviewAttempts=0"
    );
  });

  it("formats step_result build_resume", () => {
    const line = formatAdwProgressEvent({
      kind: AdwProgressKind.StepResult,
      step: AdwStep.Build,
      result: AdwStepResult.BuildResume,
      buildAttempts: 2,
      reviewAttempts: 1,
    });
    assert.strictEqual(
      line,
      "adw kind=step_result step=build result=build_resume buildAttempts=2 reviewAttempts=1"
    );
  });

  it("formats wire_miss with redacted truncated raw", () => {
    const line = formatAdwProgressEvent({
      kind: AdwProgressKind.WireMiss,
      reviewAttempts: 1,
      raw: `verdict missing gho_${"x".repeat(40)} ${"y".repeat(600)}`,
    });
    assert.isTrue(line.startsWith("adw kind=wire_miss reviewAttempts=1 raw="));
    assert.isFalse(line.includes("gho_"));
    assert.isTrue(line.includes("[REDACTED]"));
    assert.isTrue(line.includes("…"));
    const rawPart = line.slice(line.indexOf("raw=") + 4);
    assert.isTrue(rawPart.length <= DEFAULT_PROGRESS_RAW_MAX + 4);
  });
});

describe("truncateProgressRaw", () => {
  it("leaves short strings unchanged", () => {
    assert.strictEqual(truncateProgressRaw("hi", 10), "hi");
  });

  it("truncates long strings with ellipsis", () => {
    assert.strictEqual(truncateProgressRaw("abcdefghij", 5), "abcde…");
  });
});
