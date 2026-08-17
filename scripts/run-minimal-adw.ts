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
import { runHostOperatorMain } from "../packages/adw/src/host-operator-cli.ts";

process.exit(await runHostOperatorMain(process.argv.slice(2)));
