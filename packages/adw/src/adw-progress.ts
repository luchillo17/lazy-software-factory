import { Context, Effect, Logger, Option } from "effect";
import {
  formatAdwProgressEvent,
  type AdwProgressEvent,
} from "./adw-progress-event.ts";

/**
 * Optional progress sink. When provided (ADW worker), emits structured events
 * for the protocol. When absent, falls back to Effect.log formatting (Host).
 */
export class AdwProgressSink extends Context.Service<
  AdwProgressSink,
  {
    readonly emit: (event: AdwProgressEvent) => Effect.Effect<void>;
  }
>()("@lazy-software-factory/adw/AdwProgressSink") {}

const messageParts = (message: unknown): unknown[] =>
  Array.isArray(message) ? message : [message];

/** Emit a typed ADW progress event through the sink or Effect's Logger. */
export const emitAdwProgress = (event: AdwProgressEvent): Effect.Effect<void> =>
  Effect.serviceOption(AdwProgressSink).pipe(
    Effect.flatMap((sink) => {
      if (Option.isSome(sink)) {
        return sink.value.emit(event);
      }
      return Effect.log(formatAdwProgressEvent(event));
    })
  );

const progressLineFromLogMessage = (message: unknown): string =>
  messageParts(message)
    .map((part) => (typeof part === "string" ? part : String(part)))
    .join(" ");

/**
 * Host stderr sink: progress (and other) Effect.log lines via console.error.
 * Provide with `Logger.layer([…])` on the Host operator path.
 */
export const adwProgressStderrLogger: Logger.Logger<unknown, void> =
  Logger.withConsoleError(
    Logger.make((options) => progressLineFromLogMessage(options.message))
  );

export const AdwProgressStderrLive = Logger.layer([adwProgressStderrLogger]);

/** Test helper: capture formatted progress lines from Effect.log. */
export const captureAdwProgressLogger = (
  lines: string[]
): Logger.Logger<unknown, void> =>
  Logger.make((options) => {
    lines.push(progressLineFromLogMessage(options.message));
  });
