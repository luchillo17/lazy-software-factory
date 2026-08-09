import type {
  AgentProviderService,
  SandboxProvider,
} from "@lazy-software-factory/runtime";
import { Effect } from "effect";
import { AdwStatus, AdwStatusSchema } from "./enums.ts";

/**
 * Minimal ADW (ADR-0007): Build → Test agent (code gate) → Review,
 * one warm sandbox per ticket; Test fail resumes Build in the same session.
 *
 * Full Effect loop lands in the happy-path ticket; this stub keeps the public
 * API Effect-first (ADR-0008) so ADW never Promise-wraps the seam.
 */
export interface MinimalAdwDeps {
  readonly sandbox: SandboxProvider["Service"];
  readonly buildAgent: AgentProviderService;
  readonly reviewAgent: AgentProviderService;
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
  readonly status: typeof AdwStatusSchema.Type;
  readonly detail?: string;
  readonly sandboxId?: string;
  readonly buildSessionId?: string;
  readonly reviewSessionId?: string;
  readonly prUrl?: string;
}

/**
 * Stub Effect entrypoint — Host loop wiring lands in follow-up #2 tickets.
 */
export const runMinimalAdw = (
  _deps: MinimalAdwDeps,
  input: MinimalAdwInput
): Effect.Effect<MinimalAdwResult> =>
  Effect.succeed({
    ticketId: input.ticketId,
    status: AdwStatus.NotImplemented,
    detail: "ADW loop stub — see ADR-0007 / ADR-0008",
  });
