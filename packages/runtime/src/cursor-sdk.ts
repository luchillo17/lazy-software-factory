import type { AgentOptions, SDKAgent } from "@cursor/sdk";
import { Agent } from "@cursor/sdk";
import { Context, Effect, Layer } from "effect";
import { AgentError } from "./errors.ts";

/** Minimal SDK surface the Cursor AgentProvider adapter needs. */
export interface CursorSdkService {
  readonly create: (
    options: AgentOptions
  ) => Effect.Effect<SDKAgent, AgentError>;
  readonly resume: (
    agentId: string,
    options?: Partial<AgentOptions>
  ) => Effect.Effect<SDKAgent, AgentError>;
}

/** Injectable `@cursor/sdk` boundary (mock in tests). */
export class CursorSdk extends Context.Service<CursorSdk, CursorSdkService>()(
  "@lazy-software-factory/runtime/CursorSdk"
) {}

const mapSdkError = (label: string) => (cause: unknown) =>
  new AgentError({
    message:
      cause instanceof Error
        ? `${label}: ${cause.message}`
        : `${label}: ${String(cause)}`,
    cause,
  });

/** Live `@cursor/sdk` Agent.create / Agent.resume. */
export const CursorSdkLive = Layer.succeed(
  CursorSdk,
  CursorSdk.of({
    create: (options) =>
      Effect.tryPromise({
        try: () => Agent.create(options),
        catch: mapSdkError("Agent.create"),
      }),
    resume: (agentId, options) =>
      Effect.tryPromise({
        try: () => Agent.resume(agentId, options),
        catch: mapSdkError("Agent.resume"),
      }),
  })
);
