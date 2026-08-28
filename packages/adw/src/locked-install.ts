import { Schema } from "effect";

/** Package managers the default Node runner can provision. */
export const SupportedPackageManager = {
  Npm: "npm",
  Pnpm: "pnpm",
  Yarn: "yarn",
} as const;
export const SupportedPackageManagerSchema = Schema.Enum(
  SupportedPackageManager
);
export type SupportedPackageManager = typeof SupportedPackageManagerSchema.Type;

/** Managers we can detect but the default runner refuses. */
export const UnsupportedPackageManager = {
  Bun: "bun",
} as const;
export const UnsupportedPackageManagerSchema = Schema.Enum(
  UnsupportedPackageManager
);
export type UnsupportedPackageManager =
  typeof UnsupportedPackageManagerSchema.Type;

export type DetectedPackageManager =
  SupportedPackageManager | UnsupportedPackageManager;

export const LockedInstallResolveTag = {
  Skip: "skip",
  Install: "install",
  Reject: "reject",
} as const;
export const LockedInstallResolveTagSchema = Schema.Enum(
  LockedInstallResolveTag
);
export type LockedInstallResolveTag = typeof LockedInstallResolveTagSchema.Type;

export type LockedInstallStep = {
  readonly command: string;
  readonly args: readonly string[];
};

export type LockedInstallPlan = {
  readonly manager: SupportedPackageManager;
  readonly steps: readonly LockedInstallStep[];
};

export type LockedInstallResolve =
  | { readonly _tag: typeof LockedInstallResolveTag.Skip }
  | {
      readonly _tag: typeof LockedInstallResolveTag.Install;
      readonly plan: LockedInstallPlan;
    }
  | {
      readonly _tag: typeof LockedInstallResolveTag.Reject;
      readonly message: string;
    };

/** Workspace signals gathered inside the sandbox (not controller paths). */
export type WorkspaceInstallSignals = {
  readonly packageManagerField?: string;
  readonly hasPnpmLock: boolean;
  readonly hasNpmLock: boolean;
  readonly hasYarnLock: boolean;
  readonly hasBunLock: boolean;
  /** When yarn.lock present and no declared Yarn version: Berry vs Classic. */
  readonly yarnLockLooksBerry?: boolean;
};

const SUPPORTED_NAMES = new Set<string>(Object.values(SupportedPackageManager));

const parsePackageManagerField = (
  field: string
):
  | {
      readonly name: DetectedPackageManager | string;
      readonly version?: string;
    }
  | undefined => {
  const trimmed = field.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const at = trimmed.indexOf("@");
  if (at <= 0) {
    return { name: trimmed.toLowerCase() };
  }
  const name = trimmed.slice(0, at).toLowerCase();
  const versionWithIntegrity = trimmed.slice(at + 1);
  const version = versionWithIntegrity.split("+")[0]?.trim();
  return {
    name,
    version: version && version.length > 0 ? version : undefined,
  };
};

const lockfilePresent = (
  name: DetectedPackageManager,
  signals: WorkspaceInstallSignals
): boolean => {
  switch (name) {
    case SupportedPackageManager.Pnpm:
      return signals.hasPnpmLock;
    case SupportedPackageManager.Npm:
      return signals.hasNpmLock;
    case SupportedPackageManager.Yarn:
      return signals.hasYarnLock;
    case UnsupportedPackageManager.Bun:
      return signals.hasBunLock;
  }
};

const lockfileLabel = (name: DetectedPackageManager): string => {
  switch (name) {
    case SupportedPackageManager.Pnpm:
      return "pnpm-lock.yaml";
    case SupportedPackageManager.Npm:
      return "package-lock.json (or npm-shrinkwrap.json)";
    case SupportedPackageManager.Yarn:
      return "yarn.lock";
    case UnsupportedPackageManager.Bun:
      return "bun.lock / bun.lockb";
  }
};

const unsupportedMessage = (name: string): string =>
  `Unsupported package manager ${name}: default Node runner supports npm, pnpm, and Yarn only (Bun and non-Node toolchains need an alternate runner image)`;

const yarnUsesImmutable = (
  version: string | undefined,
  yarnLockLooksBerry: boolean | undefined
): boolean => {
  if (version !== undefined) {
    const major = Number.parseInt(version.split(".")[0] ?? "", 10);
    if (Number.isFinite(major)) {
      return major >= 2;
    }
  }
  return yarnLockLooksBerry === true;
};

const buildPlan = (
  manager: SupportedPackageManager,
  version: string | undefined,
  signals: WorkspaceInstallSignals
): LockedInstallPlan => {
  const steps: LockedInstallStep[] = [];

  if (
    version !== undefined &&
    (manager === SupportedPackageManager.Pnpm ||
      manager === SupportedPackageManager.Yarn)
  ) {
    steps.push({ command: "corepack", args: ["enable"] });
    steps.push({
      command: "corepack",
      args: ["prepare", `${manager}@${version}`, "--activate"],
    });
  }

  switch (manager) {
    case SupportedPackageManager.Npm:
      steps.push({ command: SupportedPackageManager.Npm, args: ["ci"] });
      break;
    case SupportedPackageManager.Pnpm:
      steps.push({
        command: SupportedPackageManager.Pnpm,
        args: ["install", "--frozen-lockfile"],
      });
      break;
    case SupportedPackageManager.Yarn:
      steps.push({
        command: SupportedPackageManager.Yarn,
        args: yarnUsesImmutable(version, signals.yarnLockLooksBerry)
          ? ["install", "--immutable"]
          : ["install", "--frozen-lockfile"],
      });
      break;
  }

  return { manager, steps };
};

const lockfilesFound = (
  signals: WorkspaceInstallSignals
): DetectedPackageManager[] => {
  const found: DetectedPackageManager[] = [];
  if (signals.hasPnpmLock) found.push(SupportedPackageManager.Pnpm);
  if (signals.hasNpmLock) found.push(SupportedPackageManager.Npm);
  if (signals.hasYarnLock) found.push(SupportedPackageManager.Yarn);
  if (signals.hasBunLock) found.push(UnsupportedPackageManager.Bun);
  return found;
};

/**
 * Prefer `package.json` `packageManager`, else a single recognized lockfile.
 * Rejects missing lockfiles for a declared manager, ambiguous lockfiles,
 * and managers the default Node runner does not support.
 */
export const resolveLockedInstall = (
  signals: WorkspaceInstallSignals
): LockedInstallResolve => {
  const field = signals.packageManagerField?.trim();
  if (field !== undefined && field.length > 0) {
    const parsed = parsePackageManagerField(field);
    if (parsed === undefined) {
      return {
        _tag: LockedInstallResolveTag.Reject,
        message: `Invalid packageManager field: ${field}`,
      };
    }

    if (parsed.name === UnsupportedPackageManager.Bun) {
      return {
        _tag: LockedInstallResolveTag.Reject,
        message: unsupportedMessage(parsed.name),
      };
    }

    if (!SUPPORTED_NAMES.has(parsed.name)) {
      return {
        _tag: LockedInstallResolveTag.Reject,
        message: unsupportedMessage(parsed.name),
      };
    }

    const manager = parsed.name as SupportedPackageManager;
    if (!lockfilePresent(manager, signals)) {
      return {
        _tag: LockedInstallResolveTag.Reject,
        message: `Declared package manager ${manager} requires ${lockfileLabel(manager)} for locked install`,
      };
    }

    return {
      _tag: LockedInstallResolveTag.Install,
      plan: buildPlan(manager, parsed.version, signals),
    };
  }

  const found = lockfilesFound(signals);
  if (found.length === 0) {
    return { _tag: LockedInstallResolveTag.Skip };
  }
  if (found.length > 1) {
    return {
      _tag: LockedInstallResolveTag.Reject,
      message: `Contradictory lockfiles without packageManager metadata: ${found.join(", ")}`,
    };
  }

  const only = found[0]!;
  if (only === UnsupportedPackageManager.Bun) {
    return {
      _tag: LockedInstallResolveTag.Reject,
      message: unsupportedMessage(only),
    };
  }

  return {
    _tag: LockedInstallResolveTag.Install,
    plan: buildPlan(only, undefined, signals),
  };
};
