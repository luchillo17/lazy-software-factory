/**
 * Pluggable sandbox backend (classic Docker locally; BYO cloud later).
 * One warm sandbox per ticket/task — create once, exec gates and agents inside it.
 */
export interface Sandbox {
  readonly id: string;
  exec(command: string, args?: readonly string[]): Promise<ExecResult>;
  destroy(): Promise<void>;
}

export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CreateSandboxOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly image?: string;
}

export interface SandboxProvider {
  create(options?: CreateSandboxOptions): Promise<Sandbox>;
}

/**
 * Agent provider seam (Cursor SDK first: create + resume inside a warm sandbox).
 */
export interface AgentSession {
  readonly sessionId: string;
}

export interface AgentRunOptions {
  readonly prompt: string;
  readonly sandbox: Sandbox;
  readonly model?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface AgentProvider {
  run(options: AgentRunOptions): Promise<AgentSession>;
  resume(
    session: AgentSession,
    options: AgentRunOptions
  ): Promise<AgentSession>;
}
