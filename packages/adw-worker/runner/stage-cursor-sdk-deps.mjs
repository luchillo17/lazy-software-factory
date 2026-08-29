#!/usr/bin/env node
/**
 * Stage the lockfile-derived production dependency graph for @cursor/sdk
 * (and its Linux native helper) into a self-contained directory tree.
 *
 * Walks pnpm's virtual store from the SDK package outward so transitive
 * siblings (e.g. undici via @connectrpc/connect-node) are included — not
 * only packages adjacent to @cursor/sdk in one virtual-store node_modules.
 *
 * Usage:
 *   node stage-cursor-sdk-deps.mjs --root <factory-root> --dest <dir> --linux-native <sdk-linux-*>
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const usage = () => {
  console.error(
    "usage: stage-cursor-sdk-deps.mjs --root <factory-root> --dest <dir> --linux-native <name>"
  );
  process.exit(2);
};

const parseArgs = (argv) => {
  const options = { root: "", dest: "", linuxNative: "" };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === "--root") options.root = argv[++i] ?? "";
    else if (argument === "--dest") options.dest = argv[++i] ?? "";
    else if (argument === "--linux-native")
      options.linuxNative = argv[++i] ?? "";
    else usage();
  }
  if (!options.root || !options.dest || !options.linuxNative) usage();
  return options;
};

const resolveCursorSdkDir = (root) => {
  for (const candidate of [
    join(root, "packages/runtime/node_modules/@cursor/sdk"),
    join(root, "node_modules/@cursor/sdk"),
  ]) {
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  return null;
};

/** Yield [packageName, absolutePath] for entries in a node_modules directory. */
function* iterPackages(nmDir) {
  if (!existsSync(nmDir) || !statSync(nmDir).isDirectory()) return;
  for (const name of readdirSync(nmDir)) {
    if (name.startsWith(".")) continue;
    const full = join(nmDir, name);
    if (name.startsWith("@")) {
      if (!statSync(full).isDirectory()) continue;
      for (const scoped of readdirSync(full)) {
        yield [`${name}/${scoped}`, join(full, scoped)];
      }
    } else {
      yield [name, full];
    }
  }
}

/** Virtual-store node_modules directory that owns this real package path. */
const virtualNodeModulesFor = (packageName, realPkgDir) =>
  packageName.includes("/")
    ? resolve(realPkgDir, "../..")
    : resolve(realPkgDir, "..");

/**
 * BFS from the SDK's virtual-store node_modules across every linked package's
 * own virtual-store node_modules (pnpm production graph reachable from SDK).
 */
const collectProductionClosure = (sdkDir) => {
  const startingNodeModules = resolve(sdkDir, "../..");
  const visitedNodeModules = new Set();
  /** @type {Map<string, string>} name -> real package directory */
  const packages = new Map();
  const queue = [startingNodeModules];

  while (queue.length > 0) {
    const nodeModulesDir = realpathSync(queue.shift());
    if (visitedNodeModules.has(nodeModulesDir)) continue;
    visitedNodeModules.add(nodeModulesDir);

    for (const [name, link] of iterPackages(nodeModulesDir)) {
      let realPkg;
      try {
        realPkg = realpathSync(link);
      } catch {
        continue;
      }
      if (!packages.has(name)) packages.set(name, realPkg);
      const packageNodeModules = virtualNodeModulesFor(name, realPkg);
      if (!visitedNodeModules.has(packageNodeModules))
        queue.push(packageNodeModules);
    }
  }

  return packages;
};

const copyPackageTree = (realPkgDir, destPkgDir) => {
  mkdirSync(dirname(destPkgDir), { recursive: true });
  if (existsSync(destPkgDir))
    rmSync(destPkgDir, { recursive: true, force: true });
  // Dereference so host pnpm-store / .pnpm symlinks never enter the image context.
  cpSync(realPkgDir, destPkgDir, { recursive: true, dereference: true });
};

const dropOtherPlatformNatives = (dest, linuxNative) => {
  const cursorDir = join(dest, "@cursor");
  if (!existsSync(cursorDir)) return;
  for (const name of readdirSync(cursorDir)) {
    if (!name.startsWith("sdk-")) continue;
    if (name === linuxNative) continue;
    rmSync(join(cursorDir, name), { recursive: true, force: true });
  }
};

const findDanglingSymlinks = (root) => {
  const dangling = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        try {
          realpathSync(full);
        } catch {
          dangling.push(full);
        }
        continue;
      }
      if (st.isDirectory()) walk(full);
    }
  };
  walk(root);
  return dangling;
};

/** Fail if any symlink target resolves outside dest (host store leak). */
const assertNoExternalSymlinks = (dest) => {
  const destReal = realpathSync(dest);
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        const target = readlinkSync(full);
        let realTarget;
        try {
          realTarget = realpathSync(full);
        } catch {
          throw new Error(`dangling symlink in staging: ${full} -> ${target}`);
        }
        if (realTarget !== destReal && !realTarget.startsWith(`${destReal}/`)) {
          throw new Error(
            `host-linked symlink in staging (must be self-contained): ${full} -> ${target}`
          );
        }
        continue;
      }
      if (st.isDirectory()) walk(full);
    }
  };
  walk(dest);
};

const smokeLoad = (dest, linuxNative) => {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      "require.resolve('@cursor/sdk'); require('@connectrpc/connect-node'); require.resolve('undici');",
    ],
    {
      env: { ...process.env, NODE_PATH: dest },
      encoding: "utf8",
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `staged Cursor closure failed smoke load:\n${result.stderr || result.stdout}`
    );
  }

  const nativePkg = join(dest, "@cursor", linuxNative, "package.json");
  const nativeBin = join(dest, "@cursor", linuxNative, "bin");
  if (!existsSync(nativePkg) || !existsSync(nativeBin)) {
    throw new Error(
      `staged @cursor/${linuxNative} missing package.json or bin/ under ${dest}`
    );
  }
};

const main = () => {
  const { root, dest, linuxNative } = parseArgs(process.argv.slice(2));
  const rootAbs = resolve(root);
  const destAbs = resolve(dest);

  const sdkDir = resolveCursorSdkDir(rootAbs);
  if (!sdkDir) {
    console.error(
      "error: @cursor/sdk not found under node_modules or packages/runtime/node_modules"
    );
    console.error(
      "error: run pnpm install from the Factory root (lockfile) before building the runner image"
    );
    process.exit(1);
  }

  mkdirSync(destAbs, { recursive: true });
  for (const name of readdirSync(destAbs)) {
    rmSync(join(destAbs, name), { recursive: true, force: true });
  }

  const closure = collectProductionClosure(sdkDir);
  const nativeKey = `@cursor/${linuxNative}`;
  if (!closure.has("@cursor/sdk")) {
    console.error("error: production closure missing @cursor/sdk");
    process.exit(1);
  }
  if (!closure.has(nativeKey)) {
    console.error(`error: production closure missing ${nativeKey}`);
    process.exit(1);
  }

  for (const [name, realPkg] of closure) {
    copyPackageTree(realPkg, join(destAbs, ...name.split("/")));
  }

  dropOtherPlatformNatives(destAbs, linuxNative);

  const dangling = findDanglingSymlinks(destAbs);
  if (dangling.length > 0) {
    console.error(
      "error: dangling symlinks in cursor-mods staging (Docker context cannot follow them):"
    );
    for (const d of dangling) console.error(d);
    process.exit(1);
  }

  try {
    assertNoExternalSymlinks(destAbs);
    smokeLoad(destAbs, linuxNative);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  writeFileSync(join(destAbs, ".keep"), "");
};

main();
