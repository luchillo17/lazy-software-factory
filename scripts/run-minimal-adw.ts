/**
 * Host operator entry for one minimal ADW (ADR-0003, ADR-0007, ADR-0010).
 *
 * Loads root `.env` when present (optional — shell env alone is enough).
 * Does not print secret values. Host sandbox allows only one ADW at a time.
 *
 * Usage:
 *   pnpm adw:host -- --ticket <id> --prompt <text> [--repo-url <url>]
 */
import { resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";
import {
  exitCodeForStatus,
  formatOperatorResult,
  parseHostOperatorArgs,
  runHostMinimalAdwPromise,
} from "../packages/adw/src/host-operator.ts";

// Optional `.env`; never override vars already set in the shell.
loadDotEnv({ path: resolve(process.cwd(), ".env"), quiet: true });

const parsed = parseHostOperatorArgs(process.argv.slice(2));
if ("help" in parsed) {
  console.log(
    "Usage: pnpm adw:host -- --ticket <id> --prompt <text> [--repo-url <url>]"
  );
  console.log(
    "Host sandbox: one ADW at a time. Credentials from .env / env (CURSOR_API_KEY, GH_TOKEN) — never printed."
  );
  console.log("Local SDK model: ADW_MODEL / CURSOR_MODEL (default grok-4.5).");
  process.exit(0);
}
if ("error" in parsed) {
  console.error(parsed.error);
  process.exit(1);
}

const result = await runHostMinimalAdwPromise({
  ticketId: parsed.ticketId,
  prompt: parsed.prompt,
  repoUrl: parsed.repoUrl,
  env: Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  ),
});

console.log(formatOperatorResult(result));
process.exit(exitCodeForStatus(result.status));
