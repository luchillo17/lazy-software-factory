#!/usr/bin/env node
/**
 * Checkout-local Host bin: load Factory `tsx` / run the operator from this
 * clone even when the invoker cwd has no Factory `node_modules`. Keeps the
 * process cwd as the invoker so relative `--cwd` and ticket-1 defaults agree;
 * `scripts/adw-host.ts` still injects absolute `--cwd` when omitted.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const factoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const invokerCwd = process.cwd();
const tsxLoader = resolve(factoryRoot, "node_modules/tsx/dist/loader.mjs");
const entry = resolve(factoryRoot, "scripts/adw-host.ts");

const result = spawnSync(
  process.execPath,
  ["--import", tsxLoader, entry, ...process.argv.slice(2)],
  {
    cwd: invokerCwd,
    env: { ...process.env, ADW_HOST_INVOKER_CWD: invokerCwd },
    stdio: "inherit",
  }
);

process.exit(result.status === null ? 1 : result.status);
