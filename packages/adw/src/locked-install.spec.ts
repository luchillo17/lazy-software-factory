import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  LockedInstallResolveTag,
  SupportedPackageManager,
  resolveLockedInstall,
} from "./locked-install.ts";

describe("resolveLockedInstall", () => {
  it.effect("prefers packageManager field over lockfile name", () =>
    Effect.sync(() => {
      const resolved = resolveLockedInstall({
        packageManagerField: "npm@10.9.2",
        hasPnpmLock: true,
        hasNpmLock: true,
        hasYarnLock: false,
        hasBunLock: false,
      });
      assert.strictEqual(resolved._tag, LockedInstallResolveTag.Install);
      if (resolved._tag === LockedInstallResolveTag.Install) {
        assert.strictEqual(resolved.plan.manager, SupportedPackageManager.Npm);
        assert.deepStrictEqual(resolved.plan.steps, [
          { command: "npm", args: ["ci"] },
        ]);
      }
    })
  );

  it.effect("rejects Bun from packageManager metadata", () =>
    Effect.sync(() => {
      const resolved = resolveLockedInstall({
        packageManagerField: "bun@1.2.0",
        hasPnpmLock: false,
        hasNpmLock: false,
        hasYarnLock: false,
        hasBunLock: true,
      });
      assert.strictEqual(resolved._tag, LockedInstallResolveTag.Reject);
    })
  );

  it.effect("rejects ambiguous lockfiles without metadata", () =>
    Effect.sync(() => {
      const resolved = resolveLockedInstall({
        hasPnpmLock: true,
        hasNpmLock: false,
        hasYarnLock: true,
        hasBunLock: false,
      });
      assert.strictEqual(resolved._tag, LockedInstallResolveTag.Reject);
      if (resolved._tag === LockedInstallResolveTag.Reject) {
        assert.isTrue(resolved.message.includes("Contradictory"));
      }
    })
  );

  it.effect(
    "selects Yarn immutable for Berry major without Corepack when undeclared",
    () =>
      Effect.sync(() => {
        const resolved = resolveLockedInstall({
          hasPnpmLock: false,
          hasNpmLock: false,
          hasYarnLock: true,
          hasBunLock: false,
          yarnLockLooksBerry: true,
        });
        assert.strictEqual(resolved._tag, LockedInstallResolveTag.Install);
        if (resolved._tag === LockedInstallResolveTag.Install) {
          assert.deepStrictEqual(resolved.plan.steps, [
            { command: "yarn", args: ["install", "--immutable"] },
          ]);
        }
      })
  );
});
