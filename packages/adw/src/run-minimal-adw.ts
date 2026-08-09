import type {
  AgentProvider,
  SandboxProvider,
} from "@lazy-software-factory/runtime";

/**
 * Minimal ADW (ADR-0007): Build → Test agent (code gate) → Review,
 * one warm sandbox per ticket; Test fail resumes Build in the same session.
 */
export interface MinimalAdwDeps {
  readonly sandbox: SandboxProvider;
  readonly buildAgent: AgentProvider;
  readonly reviewAgent: AgentProvider;
  /** Shell command(s) for the Test agent coded gate (e.g. typecheck / test). */
  readonly testCommands: readonly string[];
}

export interface MinimalAdwInput {
  readonly ticketId: string;
  readonly prompt: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface MinimalAdwResult {
  readonly ticketId: string;
  readonly status: "shipped" | "failed" | "not_implemented";
  readonly detail?: string;
}

/**
 * Stub entrypoint — Docker + Cursor SDK wiring lands in a later slice.
 */
export async function runMinimalAdw(
  _deps: MinimalAdwDeps,
  input: MinimalAdwInput
): Promise<MinimalAdwResult> {
  return {
    ticketId: input.ticketId,
    status: "not_implemented",
    detail: "ADW loop stub — see ADR-0007 / ADR-0008",
  };
}
