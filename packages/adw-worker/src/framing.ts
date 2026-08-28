import { Effect, Schema } from "effect";
import {
  ADW_WORKER_PROTOCOL_VERSION,
  AdwWorkerFrameSchema,
  AdwWorkerRequestSchema,
  type AdwWorkerFrame,
  type AdwWorkerRequest,
} from "./protocol.ts";

export const AdwWorkerErrorTag = {
  AdwWorkerProtocolError: "AdwWorkerProtocolError",
} as const;
export const AdwWorkerErrorTagSchema = Schema.Enum(AdwWorkerErrorTag);

export class AdwWorkerProtocolError extends Schema.TaggedError<AdwWorkerProtocolError>()(
  AdwWorkerErrorTag.AdwWorkerProtocolError,
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

/** Encode one newline-terminated JSON frame for protocol stdout. */
export const encodeWorkerFrame = (frame: AdwWorkerFrame): string =>
  `${JSON.stringify(frame)}\n`;

/** Encode the worker request as one JSON line for worker stdin. */
export const encodeWorkerRequest = (request: AdwWorkerRequest): string =>
  `${JSON.stringify(request)}\n`;

const parseJsonLine = (
  line: string,
  label: string
): Effect.Effect<unknown, AdwWorkerProtocolError> =>
  Effect.try({
    try: () => JSON.parse(line) as unknown,
    catch: (cause) =>
      new AdwWorkerProtocolError({
        message: `${label} is not valid JSON`,
        cause,
      }),
  });

export const decodeWorkerRequest = (
  line: string
): Effect.Effect<AdwWorkerRequest, AdwWorkerProtocolError> =>
  Effect.gen(function* () {
    const raw = yield* parseJsonLine(line, "Worker request");
    return yield* Schema.decodeUnknownEffect(AdwWorkerRequestSchema)(raw).pipe(
      Effect.mapError(
        (cause) =>
          new AdwWorkerProtocolError({
            message: `Worker request schema decode failed: ${cause.message}`,
            cause,
          })
      )
    );
  });

export const decodeWorkerFrame = (
  line: string
): Effect.Effect<AdwWorkerFrame, AdwWorkerProtocolError> =>
  Effect.gen(function* () {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return yield* new AdwWorkerProtocolError({
        message: "Empty worker protocol frame",
      });
    }
    const raw = yield* parseJsonLine(trimmed, "Worker protocol frame");
    if (
      typeof raw === "object" &&
      raw !== null &&
      "protocolVersion" in raw &&
      (raw as { protocolVersion: unknown }).protocolVersion !==
        ADW_WORKER_PROTOCOL_VERSION
    ) {
      return yield* new AdwWorkerProtocolError({
        message: `Unsupported worker protocol version: ${String(
          (raw as { protocolVersion: unknown }).protocolVersion
        )}`,
      });
    }
    return yield* Schema.decodeUnknownEffect(AdwWorkerFrameSchema)(raw).pipe(
      Effect.mapError(
        (cause) =>
          new AdwWorkerProtocolError({
            message: `Worker protocol frame schema decode failed: ${cause.message}`,
            cause,
          })
      )
    );
  });
