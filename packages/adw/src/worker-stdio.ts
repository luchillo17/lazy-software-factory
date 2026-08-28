import { redactWorkerDiagnostics } from "@lazy-software-factory/adw-worker";

type WriteCallback = (error?: Error | null) => void;

export interface WorkerOutputWriter {
  write(
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | WriteCallback,
    callback?: WriteCallback
  ): boolean;
}

export interface WorkerProtocolStdoutGuard {
  readonly writeProtocol: (frame: string) => boolean;
  readonly restore: () => void;
}

const chunkText = (
  chunk: string | Uint8Array,
  encodingOrCallback?: BufferEncoding | WriteCallback
): string =>
  typeof chunk === "string"
    ? chunk
    : Buffer.from(chunk).toString(
        typeof encodingOrCallback === "string" ? encodingOrCallback : "utf8"
      );

/**
 * Reserve worker stdout for framed protocol messages.
 *
 * Cursor SDK and other process-local dependencies may write diagnostics
 * directly to stdout. Redirect those writes to redacted stderr while retaining
 * a private handle that only the protocol encoder can use.
 */
export const installWorkerProtocolStdoutGuard = (
  stdout: WorkerOutputWriter,
  stderr: WorkerOutputWriter
): WorkerProtocolStdoutGuard => {
  const originalWrite = stdout.write.bind(stdout);
  let restored = false;

  stdout.write = (chunk, encodingOrCallback, callback) => {
    const done =
      typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    const diagnostic = redactWorkerDiagnostics(
      chunkText(chunk, encodingOrCallback)
    );
    return done ? stderr.write(diagnostic, done) : stderr.write(diagnostic);
  };

  return {
    writeProtocol: (frame) => originalWrite(frame),
    restore: () => {
      if (!restored) {
        restored = true;
        stdout.write = originalWrite;
      }
    },
  };
};
