import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  PackageManager,
  detectPackageManager,
  resolvePackageJsonTestCommands,
} from "./package-json-test-commands.ts";

const writePkg = (
  cwd: string,
  body: Record<string, unknown>,
  lockfile?: string
) => {
  writeFileSync(join(cwd, "package.json"), JSON.stringify(body, null, 2));
  if (lockfile) {
    writeFileSync(join(cwd, lockfile), "");
  }
};

describe("package.json Test commands", () => {
  it.effect("detects pnpm from packageManager field", () =>
    Effect.sync(() => {
      const cwd = mkdtempSync(join(tmpdir(), "adw-test-cmds-"));
      writePkg(cwd, { packageManager: "pnpm@9.0.0", scripts: {} });
      assert.strictEqual(detectPackageManager(cwd), PackageManager.Pnpm);
    })
  );

  it.effect("detects pnpm from lockfile when field absent", () =>
    Effect.sync(() => {
      const cwd = mkdtempSync(join(tmpdir(), "adw-test-cmds-"));
      writePkg(cwd, { scripts: {} }, "pnpm-lock.yaml");
      assert.strictEqual(detectPackageManager(cwd), PackageManager.Pnpm);
    })
  );

  it.effect("picks first non-mutating script per category", () =>
    Effect.sync(() => {
      const cwd = mkdtempSync(join(tmpdir(), "adw-test-cmds-"));
      writePkg(
        cwd,
        {
          packageManager: "pnpm@9.0.0",
          scripts: {
            "type-check": "tsc -p .",
            lint: "eslint .",
            "lint:check": "eslint .",
            "lint:fix": "eslint . --fix",
            test: "vitest",
            "test:run": "vitest run",
          },
        },
        "pnpm-lock.yaml"
      );
      assert.deepStrictEqual(resolvePackageJsonTestCommands(cwd), [
        { command: "pnpm", args: ["run", "type-check"] },
        { command: "pnpm", args: ["run", "lint:check"] },
        { command: "pnpm", args: ["run", "test:run"] },
      ]);
    })
  );

  it.effect("returns empty when package.json missing or no check scripts", () =>
    Effect.sync(() => {
      const emptyDir = mkdtempSync(join(tmpdir(), "adw-test-cmds-"));
      assert.deepStrictEqual(resolvePackageJsonTestCommands(emptyDir), []);

      const noChecks = mkdtempSync(join(tmpdir(), "adw-test-cmds-"));
      writePkg(noChecks, { scripts: { dev: "next dev", build: "next build" } });
      assert.deepStrictEqual(resolvePackageJsonTestCommands(noChecks), []);
    })
  );

  it.effect("uses npm run when only package-lock present", () =>
    Effect.sync(() => {
      const cwd = mkdtempSync(join(tmpdir(), "adw-test-cmds-"));
      mkdirSync(cwd, { recursive: true });
      writePkg(cwd, { scripts: { lint: "eslint ." } }, "package-lock.json");
      assert.deepStrictEqual(resolvePackageJsonTestCommands(cwd), [
        { command: "npm", args: ["run", "lint"] },
      ]);
    })
  );
});
