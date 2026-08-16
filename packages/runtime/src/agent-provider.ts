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

/**
 * Structural custom-tool shape (Cursor `SDKCustomTool` compatible).
 * Keeps `@cursor/sdk` out of ADW; adapter casts when calling Agent.create.
 */
export interface AgentCustomTool {
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly execute: (
    args: Record<string, unknown>,
    context: { readonly toolCallId?: string }
  ) => unknown | Promise<unknown>;
}

/**
 * Structural subagent definition (Cursor `AgentDefinition` compatible).
 * Keeps `@cursor/sdk` out of ADW; adapter maps `model` string ids to SDK
 * `ModelSelection` (or passes `"inherit"` through).
 *
 * Empty catalog (no inline `agents` and no `.cursor/agents/*.md` on disk) means
 * the parent may keep work inline — soft skill guidance only, not an ADW hard
 * guarantee of dual/parallel spawn.
 */
export interface AgentSubagentDefinition {
  readonly description: string;
  readonly prompt: string;
  /** Model id, or `"inherit"` to use the parent agent's model. */
  readonly model?: string | "inherit";
}

export interface AgentRunOptions {
  readonly prompt: string;
  /** Every agent call requires a sandbox pointer — never “no sandbox.” */
  readonly sandbox: Sandbox;
  readonly model?: string;
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Local Cursor SDK `customTools` (e.g. Review submit tools, ADR-0014).
   * Ignored by non-Cursor adapters; Factory ADWs use SDK local agents.
   */
  readonly customTools?: Record<string, AgentCustomTool>;
  /**
   * Extra local workspace roots merged with `sandbox.cwd` (Cursor `local.dirs`).
   * Host Review uses this to expose the bundled `/adw-review` skill pack.
   */
  readonly workspaceDirs?: readonly string[];
  /**
   * Inline Cursor SDK subagents (`Agent.create` / `resume` `agents` map).
   * When omitted, file-based `.cursor/agents/*.md` remain usable per SDK
   * precedence (inline overrides files when both exist). Runtime does not
   * disallow the Agent/task tool — spawn stays possible when definitions exist.
   * Empty catalog ⇒ parent inline fallback is expected (not dual-spawn guarantee).
   */
  readonly agents?: Record<string, AgentSubagentDefinition>;
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
 * Effect seam for LLM agents. Cursor SDK adapter: `cursor-agent-provider.ts`.
 * Build and Review are separate Layer tags sharing this service shape.
 */
export class AgentProvider extends Context.Service<
  AgentProvider,
  AgentProviderService
>()("@lazy-software-factory/runtime/AgentProvider") {
  /** Placeholder Layer when no Cursor (or other) adapter is wired. */
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
