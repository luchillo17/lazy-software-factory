import { assert, describe, it } from "@effect/vitest";
import { Effect, Logger } from "effect";
import {
  AdwProgressKind,
  AdwStep,
  formatAdwProgressEvent,
} from "./adw-progress-event.ts";
import { captureAdwProgressLogger, emitAdwProgress } from "./adw-progress.ts";

describe("emitAdwProgress", () => {
  it.effect("writes formatted line through Effect Logger", () => {
    const lines: string[] = [];
    const event = {
      kind: AdwProgressKind.StepEnter,
      step: AdwStep.Build,
      buildAttempts: 1,
      reviewAttempts: 0,
    } as const;

    return emitAdwProgress(event).pipe(
      Effect.provide(Logger.layer([captureAdwProgressLogger(lines)])),
      Effect.map(() => {
        assert.deepStrictEqual(lines, [formatAdwProgressEvent(event)]);
      })
    );
  });
});
