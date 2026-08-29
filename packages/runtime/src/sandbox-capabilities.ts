/**
 * Shared SandboxProvider capability / limit resolution.
 * Hard misses fail before allocation; soft misses stay on effective metadata.
 */
import {
  AdwWorkerResourceLimitKind,
  AdwWorkerSandboxFeature,
  AdwWorkerSupportLevel,
  defaultMinimalAdwCapabilityRequirements,
  type AdwWorkerCapability,
  type AdwWorkerCapabilityRequirements,
  type AdwWorkerEffectiveCapabilities,
  type AdwWorkerIsolation,
  type AdwWorkerResourceLimitKind as ResourceLimitKind,
  type AdwWorkerResourceLimits,
  type AdwWorkerSandboxFeature as SandboxFeature,
  type AdwWorkerSupportLevel as SupportLevel,
} from "@lazy-software-factory/adw-worker";
import { Effect } from "effect";
import { SandboxCapabilityError } from "./errors.ts";

/** What a backend can enforce independently of a single lease request. */
export interface BackendCapabilityProfile {
  readonly capabilities: readonly AdwWorkerCapability[];
  readonly maxConcurrentLeases: number;
  readonly isolation: AdwWorkerIsolation;
  readonly diskQuota: SupportLevel;
  readonly retainedWorkspaces: SupportLevel;
  /** Resource limit kinds this backend can actually enforce. */
  readonly enforceableLimits: ReadonlySet<ResourceLimitKind>;
  /** Defaults from Layer config applied when the request omits a limit. */
  readonly defaultLimits?: AdwWorkerResourceLimits;
}

const featureSupport = (
  profile: BackendCapabilityProfile,
  feature: SandboxFeature
): SupportLevel => {
  switch (feature) {
    case AdwWorkerSandboxFeature.DiskQuota:
      return profile.diskQuota;
    case AdwWorkerSandboxFeature.RetainedWorkspaces:
      return profile.retainedWorkspaces;
    default: {
      const _exhaustive: never = feature;
      return _exhaustive;
    }
  }
};

const limitKindsPresent = (
  limits: AdwWorkerResourceLimits | undefined
): ResourceLimitKind[] => {
  if (!limits) {
    return [];
  }
  const kinds: ResourceLimitKind[] = [];
  if (limits.cpu !== undefined) {
    kinds.push(AdwWorkerResourceLimitKind.Cpu);
  }
  if (limits.memoryBytes !== undefined) {
    kinds.push(AdwWorkerResourceLimitKind.Memory);
  }
  if (limits.pidsLimit !== undefined) {
    kinds.push(AdwWorkerResourceLimitKind.Pid);
  }
  if (limits.lifetimeMs !== undefined) {
    kinds.push(AdwWorkerResourceLimitKind.Lifetime);
  }
  return kinds;
};

const pickEnforceableLimits = (
  limits: AdwWorkerResourceLimits | undefined,
  enforceable: ReadonlySet<ResourceLimitKind>
): AdwWorkerResourceLimits | undefined => {
  if (!limits) {
    return undefined;
  }
  const out: {
    cpu?: number;
    memoryBytes?: number;
    pidsLimit?: number;
    lifetimeMs?: number;
  } = {};
  if (
    limits.cpu !== undefined &&
    enforceable.has(AdwWorkerResourceLimitKind.Cpu)
  ) {
    out.cpu = limits.cpu;
  }
  if (
    limits.memoryBytes !== undefined &&
    enforceable.has(AdwWorkerResourceLimitKind.Memory)
  ) {
    out.memoryBytes = limits.memoryBytes;
  }
  if (
    limits.pidsLimit !== undefined &&
    enforceable.has(AdwWorkerResourceLimitKind.Pid)
  ) {
    out.pidsLimit = limits.pidsLimit;
  }
  if (
    limits.lifetimeMs !== undefined &&
    enforceable.has(AdwWorkerResourceLimitKind.Lifetime)
  ) {
    out.lifetimeMs = limits.lifetimeMs;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const mergeLimits = (
  ...parts: readonly (AdwWorkerResourceLimits | undefined)[]
): AdwWorkerResourceLimits | undefined => {
  const merged: {
    cpu?: number;
    memoryBytes?: number;
    pidsLimit?: number;
    lifetimeMs?: number;
  } = {};
  for (const part of parts) {
    if (!part) {
      continue;
    }
    if (part.cpu !== undefined) {
      merged.cpu = part.cpu;
    }
    if (part.memoryBytes !== undefined) {
      merged.memoryBytes = part.memoryBytes;
    }
    if (part.pidsLimit !== undefined) {
      merged.pidsLimit = part.pidsLimit;
    }
    if (part.lifetimeMs !== undefined) {
      merged.lifetimeMs = part.lifetimeMs;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
};

/**
 * Validate hard requirements against a backend profile and build effective
 * capability / limit metadata (including unmet soft preferences).
 */
export const resolveEffectiveCapabilities = (
  profile: BackendCapabilityProfile,
  requirements?: AdwWorkerCapabilityRequirements
): Effect.Effect<AdwWorkerEffectiveCapabilities, SandboxCapabilityError> => {
  const hard =
    requirements?.hard ?? defaultMinimalAdwCapabilityRequirements.hard;
  const soft = requirements?.soft ?? [];
  const hardFeatures = requirements?.hardFeatures ?? [];
  const softFeatures = requirements?.softFeatures ?? [];
  const hardLimits = requirements?.hardLimits;
  const softLimits = requirements?.softLimits;

  const supportedCaps = new Set(profile.capabilities);
  const missingCaps = hard.filter((cap) => !supportedCaps.has(cap));
  if (missingCaps.length > 0) {
    return Effect.fail(
      new SandboxCapabilityError({
        message: `Sandbox backend missing required capabilities: ${missingCaps.join(", ")}`,
        missing: [...missingCaps],
      })
    );
  }

  const missingFeatures: string[] = [];
  for (const feature of hardFeatures) {
    if (featureSupport(profile, feature) !== AdwWorkerSupportLevel.Supported) {
      missingFeatures.push(feature);
    }
  }
  if (missingFeatures.length > 0) {
    return Effect.fail(
      new SandboxCapabilityError({
        message: `Sandbox backend missing required features: ${missingFeatures.join(", ")}`,
        missing: missingFeatures,
      })
    );
  }

  const missingLimitKinds = limitKindsPresent(hardLimits).filter(
    (kind) => !profile.enforceableLimits.has(kind)
  );
  if (missingLimitKinds.length > 0) {
    return Effect.fail(
      new SandboxCapabilityError({
        message: `Sandbox backend cannot enforce required resource limits: ${missingLimitKinds.join(", ")}`,
        missing: [...missingLimitKinds],
      })
    );
  }

  const unmetSoftCapabilities = soft.filter((cap) => !supportedCaps.has(cap));
  const unmetSoftFeatures = softFeatures.filter(
    (feature) =>
      featureSupport(profile, feature) !== AdwWorkerSupportLevel.Supported
  );
  const unmetSoftLimits = limitKindsPresent(softLimits).filter(
    (kind) => !profile.enforceableLimits.has(kind)
  );

  const appliedSoft = pickEnforceableLimits(
    softLimits,
    profile.enforceableLimits
  );
  const appliedHard = pickEnforceableLimits(
    hardLimits,
    profile.enforceableLimits
  );
  const limits = mergeLimits(
    pickEnforceableLimits(profile.defaultLimits, profile.enforceableLimits),
    appliedSoft,
    appliedHard
  );

  const effective: AdwWorkerEffectiveCapabilities = {
    capabilities: [...profile.capabilities],
    maxConcurrentLeases: profile.maxConcurrentLeases,
    isolation: profile.isolation,
    retainedWorkspaces: profile.retainedWorkspaces,
    diskQuota: profile.diskQuota,
    ...(limits ? { limits } : {}),
    ...(unmetSoftCapabilities.length > 0 ? { unmetSoftCapabilities } : {}),
    ...(unmetSoftFeatures.length > 0 ? { unmetSoftFeatures } : {}),
    ...(unmetSoftLimits.length > 0 ? { unmetSoftLimits } : {}),
  };

  return Effect.succeed(effective);
};
