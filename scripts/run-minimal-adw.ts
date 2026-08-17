/**
 * Host operator entry for one minimal ADW (ADR-0003, ADR-0007, ADR-0010).
 *
 * Loads `<cwd>/.env` when present (optional — shell env alone is enough).
 * Does not print secret values. Host sandbox allows only one ADW at a time.
 *
 * Usage:
 *   pnpm adw:host -- --issue <n|url> [--cwd <dir>] [--repo-url <url>]
 *   pnpm adw:host -- --ticket <id> --prompt <text> [--cwd <dir>] [--repo-url <url>]
 */
import { resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";
import { Effect } from "effect";
import {
  exitCodeForStatus,
  formatOperatorResult,
  hostTicketIntakeLayer,
  parseHostOperatorArgs,
  readHostOperatorCwdInput,
  resolveHostOperatorAdwInput,
  resolveHostOperatorCwd,
  runHostMinimalAdwPromise,
} from "../packages/adw/src/host-operator.ts";

const argv = process.argv.slice(2);

const parsed = parseHostOperatorArgs(argv);
if ("help" in parsed) {
  console.log(
    "Usage: pnpm adw:host -- --issue <n|#N|url> [--cwd <dir>] [--repo-url <url>]"
  );
  console.log(
    "   or: pnpm adw:host -- --ticket <id> --prompt <text> [--cwd <dir>] [--repo-url <url>]"
  );
  console.log(
    "Host cwd: --cwd / ADW_CWD (default: process cwd). Relative paths resolve from the invoker directory."
  );
  console.log(
    "Footgun: --repo-url does not replace an existing .git in that cwd (ADR-0010 reuse). Aim with --cwd, not --repo-url from a Factory checkout."
  );
  console.log(
    "Issue intake requires ready-for-agent. Credentials from <cwd>/.env / env (CURSOR_API_KEY, GH_TOKEN) — never printed."
  );
  console.log("Local SDK model: ADW_MODEL / CURSOR_MODEL (default grok-4.5).");
  process.exit(0);
}

// Resolve Host cwd before dotenv so `<cwd>/.env` can supply ADW_* / credentials.
// When parse already failed for other reasons, still validate cwd so typos fail closed.
const cwdResolved = resolveHostOperatorCwd(
  "error" in parsed ? readHostOperatorCwdInput(argv) : parsed.cwd
);
if (typeof cwdResolved !== "string") {
  console.error(cwdResolved.error);
  process.exit(1);
}

// Optional `.env`; never override vars already set in the shell.
loadDotEnv({ path: resolve(cwdResolved, ".env"), quiet: true });

// Re-parse after dotenv so ADW_ISSUE / credentials from `<cwd>/.env` apply.
const parsedAfterEnv = parseHostOperatorArgs(argv);
if ("help" in parsedAfterEnv) {
  process.exit(0);
}
if ("error" in parsedAfterEnv) {
  console.error(parsedAfterEnv.error);
  process.exit(1);
}

const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  )
);

const withCwd = { ...parsedAfterEnv, cwd: cwdResolved };

const intakeResult = await Effect.runPromise(
  resolveHostOperatorAdwInput(withCwd).pipe(
    Effect.provide(hostTicketIntakeLayer),
    Effect.result
  )
);
if (intakeResult._tag === "Failure") {
  console.error(intakeResult.failure.message);
  process.exit(1);
}

const result = await runHostMinimalAdwPromise({
  ticketId: intakeResult.success.ticketId,
  prompt: intakeResult.success.prompt,
  repoUrl: intakeResult.success.repoUrl,
  cwd: intakeResult.success.cwd ?? cwdResolved,
  env,
});

console.log(formatOperatorResult(result));
process.exit(exitCodeForStatus(result.status));
