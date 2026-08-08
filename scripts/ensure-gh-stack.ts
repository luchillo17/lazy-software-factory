/**
 * Ensure `gh stack` (github/gh-stack) is installed for contributors.
 * Soft-fail: missing gh / offline / CI without auth must not break pnpm install.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

function run(cmd: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(cmd, args, { encoding: "utf8" });
}

const gh = run("gh", ["--version"]);
if (gh.error || gh.status !== 0) {
  console.warn(
    "[ensure-gh-stack] `gh` not found — install GitHub CLI, then re-run `pnpm install` or `pnpm ensure:gh-stack`.",
  );
  process.exit(0);
}

const hasStack = run("gh", ["stack", "--help"]);
if (hasStack.status === 0) {
  process.exit(0);
}

console.log("[ensure-gh-stack] installing github/gh-stack…");
const install = run("gh", ["extension", "install", "github/gh-stack"]);
if (install.status !== 0) {
  console.warn(
    "[ensure-gh-stack] install failed — run `gh extension install github/gh-stack` manually.",
  );
  if (install.stderr) console.warn(install.stderr.trim());
  process.exit(0);
}

console.log("[ensure-gh-stack] github/gh-stack ready");
