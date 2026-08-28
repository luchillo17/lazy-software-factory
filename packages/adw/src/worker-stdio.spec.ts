import { assert, describe, it } from "@effect/vitest";
import {
  installWorkerProtocolStdoutGuard,
  type WorkerOutputWriter,
} from "./worker-stdio.ts";

const writer = (lines: string[]): WorkerOutputWriter => ({
  write: (chunk, encodingOrCallback, callback) => {
    lines.push(
      typeof chunk === "string"
        ? chunk
        : Buffer.from(chunk).toString(
            typeof encodingOrCallback === "string" ? encodingOrCallback : "utf8"
          )
    );
    const done =
      typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    done?.();
    return true;
  },
});

describe("worker protocol stdout guard", () => {
  it("keeps third-party diagnostics off protocol stdout", () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const stdout = writer(stdoutLines);
    const guard = installWorkerProtocolStdoutGuard(stdout, writer(stderrLines));

    stdout.write("SDK log GH_TOKEN=gho_abcdefghijklmnopqrstuv\n");
    guard.writeProtocol('{"kind":"progress"}\n');

    assert.deepStrictEqual(stdoutLines, ['{"kind":"progress"}\n']);
    assert.strictEqual(stderrLines.length, 1);
    assert.notInclude(stderrLines[0] ?? "", "gho_abcdefghijklmnopqrstuv");
    assert.include(stderrLines[0] ?? "", "[REDACTED]");

    guard.restore();
    stdout.write("normal stdout\n");
    assert.deepStrictEqual(stdoutLines, [
      '{"kind":"progress"}\n',
      "normal stdout\n",
    ]);
  });
});
