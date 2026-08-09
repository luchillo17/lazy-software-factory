import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";

/** Result of a captured subprocess (stdout/stderr as utf8 strings). */
export interface CapturedProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Spawn a process, capture utf8 stdout/stderr, kill on AbortSignal.
 * Optional hooks let Host sandbox track children for destroy.
 */
export const runCapturedProcess = (options: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal: AbortSignal;
  readonly onSpawn?: (child: ChildProcess) => void;
  readonly onSettle?: (child: ChildProcess) => void;
}): Promise<CapturedProcessResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
    });
    options.onSpawn?.(child);

    const onAbort = () => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    };
    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      options.signal.removeEventListener("abort", onAbort);
      options.onSettle?.(child);
      reject(err);
    });
    child.on("close", (code) => {
      options.signal.removeEventListener("abort", onAbort);
      options.onSettle?.(child);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
