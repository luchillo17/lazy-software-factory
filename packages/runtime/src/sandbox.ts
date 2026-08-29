import type { Effect } from "effect";
import type { SandboxDestroyError, SandboxExecError } from "./errors.ts";

export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CreateSandboxOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Reserved for Docker / image-backed providers; ignored by Host. */
  readonly image?: string;
}

/** Provider-neutral command execution request (never a shell string). */
export interface SandboxExecOptions {
  readonly command: string;
  readonly argv?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: string | Uint8Array;
  /** Operation timeout in milliseconds. */
  readonly timeoutMs?: number;
}

/**
 * Warm sandbox handle. Host backend: this machine's filesystem/process.
 * `exec` always runs in the sandbox context; destroy releases the Host slot.
 */
export interface Sandbox {
  readonly id: string;
  /** Working directory for exec / Ship (git host cwd). */
  readonly cwd: string;
  readonly exec: (
    options: SandboxExecOptions
  ) => Effect.Effect<ExecResult, SandboxExecError>;
  readonly destroy: () => Effect.Effect<void, SandboxDestroyError>;
}
