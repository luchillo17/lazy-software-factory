#!/usr/bin/env node
/**
 * Provider-neutral `adw` bin. Default sandbox remains host; pass
 * `--sandbox docker` explicitly for isolated runners.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const factoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const invokerCwd = process.cwd();
const tsxLoader = resolve(factoryRoot, "node_modules/tsx/dist/loader.mjs");
const entry = resolve(factoryRoot, "scripts/adw.ts");

const result = spawnSync(
  process.execPath,
  ["--import", tsxLoader, entry, ...process.argv.slice(2)],
  {
    cwd: invokerCwd,
    env: { ...process.env },
    stdio: "inherit",
  }
);

process.exit(result.status === null ? 1 : result.status);
