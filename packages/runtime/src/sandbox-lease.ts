import type { Effect } from "effect";
import type {
  AdwWorkerCapabilityRequirements,
  AdwWorkerEffectiveCapabilities,
  AdwWorkerProgressEvent,
  AdwWorkerRequest,
  AdwWorkerTerminalOutcome,
} from "@lazy-software-factory/adw-worker";
import type { AdwWorkerProtocolError } from "@lazy-software-factory/adw-worker";
import type {
  SandboxBusyError,
  SandboxCapabilityError,
  SandboxCreateError,
  SandboxDestroyError,
  SandboxWorkerError,
} from "./errors.ts";
import type { CreateSandboxOptions, Sandbox } from "./sandbox.ts";

export type { CreateSandboxOptions, ExecResult, Sandbox } from "./sandbox.ts";

/** Options when acquiring a scoped Sandbox lease for one ADW worker. */
export interface AcquireSandboxOptions extends CreateSandboxOptions {
  readonly requirements?: AdwWorkerCapabilityRequirements;
}

/**
 * Scoped controller handle for one Sandbox: capability metadata, one worker
 * run, and idempotent release (ADR-0016).
 */
export interface SandboxLease {
  readonly id: string;
  readonly cwd: string;
  readonly effectiveCapabilities: AdwWorkerEffectiveCapabilities;
  /**
   * Run exactly one versioned ADW worker. Progress frames are forwarded via
   * `onProgress`; returns the typed terminal outcome.
   */
  readonly runWorker: (
    request: AdwWorkerRequest,
    options: {
      readonly onProgress: (
        event: AdwWorkerProgressEvent
      ) => Effect.Effect<void>;
    }
  ) => Effect.Effect<
    AdwWorkerTerminalOutcome,
    SandboxWorkerError | AdwWorkerProtocolError
  >;
  /** Idempotent lease release (also runs on Scope finalizer). */
  readonly release: () => Effect.Effect<void, SandboxDestroyError>;
}

export type AcquireSandboxError =
  SandboxCreateError | SandboxBusyError | SandboxCapabilityError;
