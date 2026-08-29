/**
 * Provider-neutral Minimal ADW operator (`adw`).
 * Default sandbox is host; Docker is explicit via `--sandbox docker`.
 */
import { runOperatorMain } from "../packages/adw/src/operator-cli.ts";

process.exit(await runOperatorMain(process.argv.slice(2)));
