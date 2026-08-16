import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");

const packageSpecifiersIn = (source: string): readonly string[] => [
  ...new Set(
    [...source.matchAll(/from\s+["']([^"']+)["']/g)]
      .map((match) => match[1]!)
      .filter((spec) => !spec.startsWith(".") && !spec.startsWith("node:"))
  ),
];

describe("Host CLI root scripts", () => {
  it("declares every package specifier from scripts/ on the workspace root", () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8")
    ) as {
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly devDependencies?: Readonly<Record<string, string>>;
    };
    const declared = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    const scriptsDir = join(repoRoot, "scripts");
    const missing: string[] = [];
    for (const name of readdirSync(scriptsDir)) {
      if (!name.endsWith(".ts")) {
        continue;
      }
      const source = readFileSync(join(scriptsDir, name), "utf8");
      for (const spec of packageSpecifiersIn(source)) {
        if (!(spec in declared)) {
          missing.push(`${name}: ${spec}`);
        }
      }
    }

    assert.deepStrictEqual(missing, []);
  });
});
