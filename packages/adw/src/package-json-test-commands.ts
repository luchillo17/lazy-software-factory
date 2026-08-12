import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AdwTestCommand } from "./test-commands.ts";

/** Package managers we can invoke as `… run <script>`. */
export const PackageManager = {
  Pnpm: "pnpm",
  Npm: "npm",
  Yarn: "yarn",
  Bun: "bun",
} as const;

export type PackageManager =
  (typeof PackageManager)[keyof typeof PackageManager];

/**
 * Check-only script categories (ADR-0013). First present name in each
 * category wins; categories run in parallel. Prefer non-mutating names.
 */
export const CHECK_SCRIPT_CATEGORIES: ReadonlyArray<readonly string[]> = [
  ["type-check", "typecheck", "types"],
  ["lint:check", "lint"],
  ["test:run", "test:ci", "test:unit", "test"],
];

const MUTATING_SCRIPT = /(?:^|:)(?:fix|write|watch|dev)$/i;

type PackageJsonShape = {
  readonly packageManager?: string;
  readonly scripts?: Readonly<Record<string, string>>;
};

const readPackageJson = (cwd: string): PackageJsonShape | undefined => {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJsonShape;
  } catch {
    return undefined;
  }
};

/** Detect package manager from `packageManager` field, then lockfiles. */
export const detectPackageManager = (cwd: string): PackageManager => {
  const pkg = readPackageJson(cwd);
  const field = pkg?.packageManager?.split("@")[0]?.toLowerCase();
  if (field === PackageManager.Pnpm) return PackageManager.Pnpm;
  if (field === PackageManager.Npm) return PackageManager.Npm;
  if (field === PackageManager.Yarn) return PackageManager.Yarn;
  if (field === PackageManager.Bun) return PackageManager.Bun;

  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return PackageManager.Pnpm;
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) {
    return PackageManager.Bun;
  }
  if (existsSync(join(cwd, "yarn.lock"))) return PackageManager.Yarn;
  if (existsSync(join(cwd, "package-lock.json"))) return PackageManager.Npm;
  return PackageManager.Npm;
};

const pickScript = (
  scripts: Readonly<Record<string, string>>,
  candidates: readonly string[]
): string | undefined => {
  for (const name of candidates) {
    if (!(name in scripts)) continue;
    if (MUTATING_SCRIPT.test(name)) continue;
    return name;
  }
  return undefined;
};

/**
 * Resolve Host Test gates from the target repo `package.json` scripts.
 * Returns `pnpm|npm|yarn|bun run <script>` argv — empty if none match.
 */
export const resolvePackageJsonTestCommands = (
  cwd: string
): ReadonlyArray<AdwTestCommand> => {
  const pkg = readPackageJson(cwd);
  const scripts = pkg?.scripts;
  if (!scripts) {
    return [];
  }

  const pm = detectPackageManager(cwd);
  const picked: string[] = [];
  for (const category of CHECK_SCRIPT_CATEGORIES) {
    const name = pickScript(scripts, category);
    if (name !== undefined) {
      picked.push(name);
    }
  }

  return picked.map((script) => ({
    command: pm,
    args: ["run", script],
  }));
};
