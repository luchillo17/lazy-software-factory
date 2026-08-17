/**
 * Host operator entry for one minimal ADW (ADR-0003, ADR-0007, ADR-0010).
 *
 * Loads `<cwd>/.env` when present (optional — shell env alone is enough).
 * Does not print secret values. Host sandbox allows only one ADW at a time.
 *
 * Usage:
 *   adw-host --issue <n|url> [--cwd <dir>] [--repo-url <url>]
 *   pnpm adw:host -- --issue <n|url> [--cwd <dir>] [--repo-url <url>]
 *   pnpm adw:host -- --ticket <id> --prompt <text> [--cwd <dir>] [--repo-url <url>]
 */
import { Effect } from "effect";
import {
  exitCodeForStatus,
  formatOperatorResult,
  HostCwdError,
  hostOperatorFsLayer,
  hostTicketIntakeLayer,
  loadHostDotEnv,
  mergeHostOperatorEnv,
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
    "Usage: adw-host --issue <n|#N|url> [--cwd <dir>] [--repo-url <url>]"
  );
  console.log(
    "   or: pnpm adw:host -- --issue <n|#N|url> [--cwd <dir>] [--repo-url <url>]"
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

const prepared = await Effect.runPromise(
  Effect.gen(function* () {
    const cwd = yield* resolveHostOperatorCwd(
      "error" in parsed ? readHostOperatorCwdInput(argv) : parsed.cwd
    );
    const fileEnv = yield* loadHostDotEnv(cwd);
    return {
      cwd,
      env: mergeHostOperatorEnv(fileEnv, process.env),
    };
  }).pipe(Effect.provide(hostOperatorFsLayer), Effect.result)
);
if (prepared._tag === "Failure") {
  const failure = prepared.failure;
  console.error(
    failure instanceof HostCwdError ? failure.message : String(failure)
  );
  process.exit(1);
}

const { cwd: cwdResolved, env } = prepared.success;

// Re-parse after `<cwd>/.env` so ADW_ISSUE / credentials from the file apply.
const parsedAfterEnv = parseHostOperatorArgs(argv, env);
if ("help" in parsedAfterEnv) {
  process.exit(0);
}
if ("error" in parsedAfterEnv) {
  console.error(parsedAfterEnv.error);
  process.exit(1);
}

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
