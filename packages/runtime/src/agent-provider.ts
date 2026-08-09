import { Context, Effect, Layer } from "effect";
import { AgentError } from "./errors.ts";
import type { Sandbox } from "./sandbox.ts";

/**
 * Opaque agent session pointer. Cursor adapter maps this to SDK resume handles;
 * ADW types must not expose forge/SDK-specific field names.
 */
export interface AgentSession {
  readonly sessionId: string;
  /**
   * Optional structured payload from the agent (e.g. Review verdict).
   * Opaque to Runtime — ADW parses with Schema.
   */
  readonly output?: unknown;
}

export interface AgentRunOptions {
  readonly prompt: string;
  /** Every agent call requires a sandbox pointer — never “no sandbox.” */
  readonly sandbox: Sandbox;
  readonly model?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface AgentProviderService {
  readonly run: (
    options: AgentRunOptions
  ) => Effect.Effect<AgentSession, AgentError>;
  readonly resume: (
    session: AgentSession,
    options: AgentRunOptions
  ) => Effect.Effect<AgentSession, AgentError>;
}

const notImplementedService: AgentProviderService = {
  run: () =>
    Effect.fail(
      new AgentError({
        message: "AgentProvider not implemented — wire Cursor SDK adapter",
      })
    ),
  resume: () =>
    Effect.fail(
      new AgentError({
        message: "AgentProvider not implemented — wire Cursor SDK adapter",
      })
    ),
};

/**
 * Effect seam for LLM agents (Cursor SDK adapter lands in a later ticket).
 * Build and Review should be separate Layer tags sharing this service shape.
 */
export class AgentProvider extends Context.Service<
  AgentProvider,
  AgentProviderService
>()("@lazy-software-factory/runtime/AgentProvider") {
  /** Placeholder Layer until Cursor SDK adapter (#9). */
  static readonly NotImplemented = Layer.succeed(
    AgentProvider,
    AgentProvider.of(notImplementedService)
  );
}

/** Build-agent Layer tag — same service shape, independent prompt/model wiring. */
export class BuildAgentProvider extends Context.Service<
  BuildAgentProvider,
  AgentProviderService
>()("@lazy-software-factory/runtime/BuildAgentProvider") {
  static readonly NotImplemented = Layer.succeed(
    BuildAgentProvider,
    BuildAgentProvider.of(notImplementedService)
  );
}

/** Review-agent Layer tag — new session per Review attempt. */
export class ReviewAgentProvider extends Context.Service<
  ReviewAgentProvider,
  AgentProviderService
>()("@lazy-software-factory/runtime/ReviewAgentProvider") {
  static readonly NotImplemented = Layer.succeed(
    ReviewAgentProvider,
    ReviewAgentProvider.of(notImplementedService)
  );
}
