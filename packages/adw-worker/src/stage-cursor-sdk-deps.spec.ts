/**
 * Seam: packages/adw-worker/runner/stage-cursor-sdk-deps.mjs
 * Stages the lockfile-derived @cursor/sdk production closure for the runner image.
 */
import { describe, expect, it } from "@effect/vitest";
import { execFileSync } from "node:child_process";
import { lstat, mkdtemp, readdir, readlink, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const monorepoRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../.."
);
const stageScript = resolve(
  monorepoRoot,
  "packages/adw-worker/runner/stage-cursor-sdk-deps.mjs"
);

const hostLinuxNative = (): string => {
  const arch = process.arch;
  if (arch === "x64") return "sdk-linux-x64";
  if (arch === "arm64") return "sdk-linux-arm64";
  throw new Error(`unsupported arch for linux native staging: ${arch}`);
};

const findSymlinks = async (root: string): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        out.push(full);
        continue;
      }
      if (entry.isDirectory()) {
        const st = await lstat(full);
        if (st.isDirectory()) await walk(full);
      }
    }
  };
  await walk(root);
  return out;
};

describe("stage-cursor-sdk-deps", () => {
  it("stages transitive production deps including undici (self-contained)", async () => {
    const dest = await mkdtemp(join(tmpdir(), "cursor-mods-"));
    const linuxNative = hostLinuxNative();
    try {
      execFileSync(
        process.execPath,
        [
          stageScript,
          "--root",
          monorepoRoot,
          "--dest",
          dest,
          "--linux-native",
          linuxNative,
        ],
        { cwd: monorepoRoot, stdio: "pipe" }
      );

      execFileSync(
        process.execPath,
        [
          "-e",
          "require.resolve('@cursor/sdk'); require('@connectrpc/connect-node'); require.resolve('undici');",
        ],
        {
          env: { ...process.env, NODE_PATH: dest },
          stdio: "pipe",
        }
      );

      expect((await stat(join(dest, "undici", "package.json"))).isFile()).toBe(
        true
      );
      expect(
        (
          await stat(join(dest, "@cursor", linuxNative, "package.json"))
        ).isFile()
      ).toBe(true);
      expect(
        (await stat(join(dest, "@cursor", linuxNative, "bin"))).isDirectory()
      ).toBe(true);

      for (const link of await findSymlinks(dest)) {
        const target = await readlink(link);
        const resolved = resolve(join(link, ".."), target);
        expect(resolved === dest || resolved.startsWith(`${dest}/`)).toBe(true);
      }
    } finally {
      await rm(dest, { recursive: true, force: true });
    }
  });
});
