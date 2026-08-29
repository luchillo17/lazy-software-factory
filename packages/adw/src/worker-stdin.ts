import { createInterface } from "node:readline";

/**
 * Sequential stdin line reader. Starts buffering immediately so a second
 * protocol line is not lost between handshake and request reads.
 * Does not close process.stdin until {@link close}.
 */
export const createStdinLineReader = (): {
  readonly readLine: () => Promise<string>;
  readonly close: () => void;
} => {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending: string[] = [];
  const waiters: Array<{
    resolve: (line: string) => void;
    reject: (err: Error) => void;
  }> = [];
  let closed = false;

  rl.on("line", (line) => {
    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve(line);
    } else {
      pending.push(line);
    }
  });

  rl.on("close", () => {
    closed = true;
    while (waiters.length > 0) {
      waiters
        .shift()
        ?.reject(new Error("ADW worker stdin closed before request"));
    }
  });

  return {
    readLine: () =>
      new Promise((resolve, reject) => {
        if (pending.length > 0) {
          resolve(pending.shift()!);
          return;
        }
        if (closed) {
          reject(new Error("ADW worker stdin closed before request"));
          return;
        }
        waiters.push({ resolve, reject });
      }),
    close: () => {
      rl.close();
    },
  };
};
