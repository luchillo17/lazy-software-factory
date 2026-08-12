/**
 * Host operator entry for one minimal ADW (ADR-0003, ADR-0007, ADR-0010).
 *
 * Loads root `.env` when present (optional — shell env alone is enough).
 * Does not print secret values. Host sandbox allows only one ADW at a time.
 *
 * Usage:
 *   pnpm adw:host -- --issue <n|url> [--repo-url <url>]
 *   pnpm adw:host -- --ticket <id> --prompt <text> [--repo-url <url>]
 */
import { resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";
import { Effect } from "effect";
import {
  exitCodeForStatus,
  formatOperatorResult,
  hostTicketIntakeLayer,
  parseHostOperatorArgs,
  resolveHostOperatorAdwInput,
  runHostMinimalAdwPromise,
} from "../packages/adw/src/host-operator.ts";

// Optional `.env`; never override vars already set in the shell.
loadDotEnv({ path: resolve(process.cwd(), ".env"), quiet: true });

const parsed = parseHostOperatorArgs(process.argv.slice(2));
if ("help" in parsed) {
  console.log("Usage: pnpm adw:host -- --issue <n|#N|url> [--repo-url <url>]");
  console.log(
    "   or: pnpm adw:host -- --ticket <id> --prompt <text> [--repo-url <url>]"
  );
  console.log(
    "Issue intake requires ready-for-agent. Credentials from .env / env (CURSOR_API_KEY, GH_TOKEN) — never printed."
  );
  console.log("Local SDK model: ADW_MODEL / CURSOR_MODEL (default grok-4.5).");
  process.exit(0);
}
if ("error" in parsed) {
  console.error(parsed.error);
  process.exit(1);
}

const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  )
);

const intakeResult = await Effect.runPromise(
  resolveHostOperatorAdwInput(parsed).pipe(
    Effect.provide(hostTicketIntakeLayer),
    Effect.either
  )
);
if (intakeResult._tag === "Left") {
  console.error(intakeResult.left.message);
  process.exit(1);
}

const result = await runHostMinimalAdwPromise({
  ticketId: intakeResult.right.ticketId,
  prompt: intakeResult.right.prompt,
  repoUrl: intakeResult.right.repoUrl,
  env,
});

console.log(formatOperatorResult(result));
process.exit(exitCodeForStatus(result.status));
