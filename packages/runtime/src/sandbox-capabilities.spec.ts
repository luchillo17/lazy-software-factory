import { assert, describe, it } from "@effect/vitest";
import {
  AdwWorkerCapability,
  AdwWorkerIsolation,
  AdwWorkerResourceLimitKind,
  AdwWorkerSandboxFeature,
  AdwWorkerSupportLevel,
} from "@lazy-software-factory/adw-worker";
import { Effect } from "effect";
import {
  resolveEffectiveCapabilities,
  type BackendCapabilityProfile,
} from "./sandbox-capabilities.ts";
import { SandboxCapabilityError } from "./errors.ts";

const dockerProfile = (
  overrides?: Partial<BackendCapabilityProfile>
): BackendCapabilityProfile => ({
  capabilities: [
    AdwWorkerCapability.CursorLocalAgent,
    AdwWorkerCapability.GitHostCli,
    AdwWorkerCapability.WorkspaceExec,
    AdwWorkerCapability.SkillPackMount,
  ],
  maxConcurrentLeases: 32,
  isolation: AdwWorkerIsolation.Container,
  diskQuota: AdwWorkerSupportLevel.Unsupported,
  retainedWorkspaces: AdwWorkerSupportLevel.Unsupported,
  enforceableLimits: new Set([
    AdwWorkerResourceLimitKind.Cpu,
    AdwWorkerResourceLimitKind.Memory,
    AdwWorkerResourceLimitKind.Pid,
    AdwWorkerResourceLimitKind.Lifetime,
  ]),
  ...overrides,
});

const hostProfile = (): BackendCapabilityProfile => ({
  capabilities: [
    AdwWorkerCapability.CursorLocalAgent,
    AdwWorkerCapability.GitHostCli,
    AdwWorkerCapability.WorkspaceExec,
    AdwWorkerCapability.SkillPackMount,
  ],
  maxConcurrentLeases: 1,
  isolation: AdwWorkerIsolation.Host,
  diskQuota: AdwWorkerSupportLevel.Unsupported,
  retainedWorkspaces: AdwWorkerSupportLevel.Unsupported,
  enforceableLimits: new Set(),
});

describe("resolveEffectiveCapabilities", () => {
  it.effect("fails hard disk_quota before reporting effective metadata", () =>
    Effect.gen(function* () {
      const result = yield* resolveEffectiveCapabilities(dockerProfile(), {
        hard: [AdwWorkerCapability.WorkspaceExec],
        hardFeatures: [AdwWorkerSandboxFeature.DiskQuota],
      }).pipe(Effect.exit);
      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        const err = result.cause;
        assert.isTrue(
          String(err).includes(AdwWorkerSandboxFeature.DiskQuota) ||
            err._tag === "Fail"
        );
      }
    })
  );

  it.effect(
    "surfaces unmet soft features and soft limits without failing",
    () =>
      Effect.gen(function* () {
        const effective = yield* resolveEffectiveCapabilities(dockerProfile(), {
          hard: [AdwWorkerCapability.WorkspaceExec],
          softFeatures: [
            AdwWorkerSandboxFeature.DiskQuota,
            AdwWorkerSandboxFeature.RetainedWorkspaces,
          ],
          softLimits: { cpu: 2, lifetimeMs: 10_000 },
        });
        assert.deepStrictEqual(effective.unmetSoftFeatures, [
          AdwWorkerSandboxFeature.DiskQuota,
          AdwWorkerSandboxFeature.RetainedWorkspaces,
        ]);
        assert.strictEqual(effective.limits?.cpu, 2);
        assert.strictEqual(effective.limits?.lifetimeMs, 10_000);
        assert.isUndefined(effective.unmetSoftLimits);
      })
  );

  it.effect("applies Docker hard resource limits into effective.limits", () =>
    Effect.gen(function* () {
      const effective = yield* resolveEffectiveCapabilities(dockerProfile(), {
        hard: [AdwWorkerCapability.WorkspaceExec],
        hardLimits: {
          cpu: 1.5,
          memoryBytes: 268_435_456,
          pidsLimit: 256,
          lifetimeMs: 60_000,
        },
      });
      assert.deepStrictEqual(effective.limits, {
        cpu: 1.5,
        memoryBytes: 268_435_456,
        pidsLimit: 256,
        lifetimeMs: 60_000,
      });
    })
  );

  it.effect("Host rejects hard CPU limits it cannot enforce", () =>
    Effect.gen(function* () {
      const result = yield* resolveEffectiveCapabilities(hostProfile(), {
        hard: [AdwWorkerCapability.WorkspaceExec],
        hardLimits: { cpu: 1 },
      }).pipe(Effect.exit);
      assert.strictEqual(result._tag, "Failure");
    })
  );

  it.effect("Host records unmet soft resource preferences", () =>
    Effect.gen(function* () {
      const effective = yield* resolveEffectiveCapabilities(hostProfile(), {
        hard: [AdwWorkerCapability.WorkspaceExec],
        softLimits: { memoryBytes: 1_073_741_824 },
        softFeatures: [AdwWorkerSandboxFeature.DiskQuota],
      });
      assert.deepStrictEqual(effective.unmetSoftLimits, [
        AdwWorkerResourceLimitKind.Memory,
      ]);
      assert.deepStrictEqual(effective.unmetSoftFeatures, [
        AdwWorkerSandboxFeature.DiskQuota,
      ]);
      assert.isUndefined(effective.limits);
    })
  );

  it.effect("merges Layer defaultLimits under request hardLimits", () =>
    Effect.gen(function* () {
      const effective = yield* resolveEffectiveCapabilities(
        dockerProfile({
          defaultLimits: { cpu: 0.5, pidsLimit: 64 },
        }),
        {
          hard: [AdwWorkerCapability.WorkspaceExec],
          hardLimits: { cpu: 2 },
        }
      );
      assert.strictEqual(effective.limits?.cpu, 2);
      assert.strictEqual(effective.limits?.pidsLimit, 64);
    })
  );
});

void SandboxCapabilityError;
