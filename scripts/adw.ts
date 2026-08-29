/**
 * Provider-neutral Minimal ADW operator (`adw`).
 * Default sandbox is docker; Host via `--sandbox host` or `adw-host`.
 */
import { runOperatorMain } from "../packages/adw/src/operator-cli.ts";

process.exit(await runOperatorMain(process.argv.slice(2)));
