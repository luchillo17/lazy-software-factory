import type { Sandbox } from "@lazy-software-factory/runtime/sandbox";
import { Context, Effect, Layer, Schema } from "effect";
import { truncateProgressRaw } from "./adw-progress-event.ts";
import { GitHost, GitHostError, type GitHostService } from "./git-host.ts";
import {
  LockedInstallResolveTag,
  SupportedPackageManager,
  resolveLockedInstall,
  type WorkspaceInstallSignals,
} from "./locked-install.ts";
import { redactSecrets } from "./redact-secrets.ts";
import { ticketBranch } from "./ticket-branch.ts";

/** Bound install failure text in ADW `detail` (after redaction). */
const INSTALL_DIAGNOSTIC_MAX_CHARS = 2_000;

export const ProvisionErrorTag = {
  ProvisionError: "ProvisionError",
} as const;
export const ProvisionErrorTagSchema = Schema.Enum(ProvisionErrorTag);

export class ProvisionError extends Schema.TaggedError<ProvisionError>()(
  ProvisionErrorTag.ProvisionError,
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export interface WorkspaceProvisionService {
  /**
   * Deterministic setup before Build (ADR-0010): ensure git worktree
   * (reuse or clone), checkout ticket branch, locked install when present.
   */
  readonly provision: (options: {
    readonly sandbox: Sandbox;
    readonly ticketId: string;
    readonly repoUrl?: string;
    /** Optional branch name or commit SHA after clone. */
    readonly startingRef?: string;
    readonly env?: Readonly<Record<string, string>>;
  }) => Effect.Effect<void, ProvisionError>;
}

const execOrProvisionFail = (
  sandbox: Sandbox,
  command: string,
  args: readonly string[],
  label: string
): Effect.Effect<
  {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  },
  ProvisionError
> =>
  sandbox.exec({ command, argv: args }).pipe(
    Effect.mapError(
      (err) =>
        new ProvisionError({
          message: `${label}: ${err.message}`,
          cause: err,
        })
    )
  );

const requireZero = (
  result: {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  },
  label: string
): Effect.Effect<void, ProvisionError> =>
  result.exitCode === 0
    ? Effect.void
    : Effect.fail(
        new ProvisionError({
          message: `${label} failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
        })
      );

const requireZeroInstall = (
  result: {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  },
  label: string
): Effect.Effect<void, ProvisionError> => {
  if (result.exitCode === 0) {
    return Effect.void;
  }
  const body = redactSecrets(result.stderr || result.stdout || "");
  return Effect.fail(
    new ProvisionError({
      message: `${label} failed (exit ${result.exitCode}): ${truncateProgressRaw(body, INSTALL_DIAGNOSTIC_MAX_CHARS)}`,
    })
  );
};

const fileExists = (
  sandbox: Sandbox,
  relativePath: string
): Effect.Effect<boolean, ProvisionError> =>
  execOrProvisionFail(
    sandbox,
    "test",
    ["-f", relativePath],
    `test -f ${relativePath}`
  ).pipe(Effect.map((r) => r.exitCode === 0));

const readPackageManagerField = (
  sandbox: Sandbox
): Effect.Effect<string | undefined, ProvisionError> =>
  Effect.gen(function* () {
    const cat = yield* execOrProvisionFail(
      sandbox,
      "cat",
      ["package.json"],
      "read package.json"
    );
    if (cat.exitCode !== 0) {
      return undefined;
    }
    const parsed = yield* Effect.try({
      try: () => JSON.parse(cat.stdout) as unknown,
      catch: () =>
        new ProvisionError({
          message: "package.json is not valid JSON",
        }),
    });
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "packageManager" in parsed &&
      typeof (parsed as { packageManager: unknown }).packageManager === "string"
    ) {
      return (parsed as { packageManager: string }).packageManager;
    }
    return undefined;
  });

const yarnLockLooksBerry = (
  sandbox: Sandbox,
  hasYarnLock: boolean
): Effect.Effect<boolean, ProvisionError> =>
  Effect.gen(function* () {
    if (!hasYarnLock) {
      return false;
    }
    const head = yield* execOrProvisionFail(
      sandbox,
      "head",
      ["-n", "40", "yarn.lock"],
      "read yarn.lock"
    );
    if (head.exitCode !== 0) {
      return false;
    }
    return /(?:^|\n)__metadata:\s*(?:\n|$)/.test(head.stdout);
  });

const gatherInstallSignals = (
  sandbox: Sandbox
): Effect.Effect<WorkspaceInstallSignals, ProvisionError> =>
  Effect.gen(function* () {
    const packageManagerField = yield* readPackageManagerField(sandbox);
    const hasPnpmLock = yield* fileExists(sandbox, "pnpm-lock.yaml");
    const hasPackageLock = yield* fileExists(sandbox, "package-lock.json");
    const hasShrinkwrap = yield* fileExists(sandbox, "npm-shrinkwrap.json");
    const hasYarnLock = yield* fileExists(sandbox, "yarn.lock");
    const hasBunLockb = yield* fileExists(sandbox, "bun.lockb");
    const hasBunLock = yield* fileExists(sandbox, "bun.lock");

    const signals: WorkspaceInstallSignals = {
      packageManagerField,
      hasPnpmLock,
      hasNpmLock: hasPackageLock || hasShrinkwrap,
      hasYarnLock,
      hasBunLock: hasBunLockb || hasBunLock,
    };

    const needsBerrySniff =
      hasYarnLock &&
      (packageManagerField === undefined ||
        packageManagerField
          .trim()
          .toLowerCase()
          .startsWith(SupportedPackageManager.Yarn));

    if (!needsBerrySniff) {
      return signals;
    }

    const looksBerry = yield* yarnLockLooksBerry(sandbox, hasYarnLock);
    return { ...signals, yarnLockLooksBerry: looksBerry };
  });

const runLockedInstall = (
  sandbox: Sandbox
): Effect.Effect<void, ProvisionError> =>
  Effect.gen(function* () {
    const signals = yield* gatherInstallSignals(sandbox);
    const resolved = resolveLockedInstall(signals);

    if (resolved._tag === LockedInstallResolveTag.Skip) {
      return;
    }
    if (resolved._tag === LockedInstallResolveTag.Reject) {
      return yield* new ProvisionError({ message: resolved.message });
    }

    for (const step of resolved.plan.steps) {
      const label = `${step.command} ${step.args.join(" ")}`;
      const result = yield* execOrProvisionFail(
        sandbox,
        step.command,
        step.args,
        label
      );
      yield* requireZeroInstall(result, label);
    }
  });

const mapGitHostError = (err: GitHostError): ProvisionError =>
  new ProvisionError({
    message: `git host preflight failed: ${err.message}`,
    cause: err,
  });

const refuseTicketBranchCollision = (options: {
  readonly branch: string;
  readonly remote: string;
  readonly remoteExists: boolean;
  readonly openPrUrl: string | null;
}): Effect.Effect<void, ProvisionError> => {
  const { branch, remote, remoteExists, openPrUrl } = options;
  if (!remoteExists && openPrUrl === null) {
    return Effect.void;
  }

  const parts: string[] = [];
  if (remoteExists) {
    parts.push(
      `Ticket branch ${branch} already exists on remote ${remote} (refusing overwrite; no force-push).`
    );
  }
  if (openPrUrl !== null) {
    parts.push(
      remoteExists
        ? `Open PR: ${openPrUrl}`
        : `Open pull request already exists for head ${branch}: ${openPrUrl} (refusing to re-provision; no force-push).`
    );
  }
  return Effect.fail(new ProvisionError({ message: parts.join(" ") }));
};

const checkoutBranchAndInstall = (
  sandbox: Sandbox,
  ticketId: string,
  gitHost: GitHostService,
  env?: Readonly<Record<string, string>>
): Effect.Effect<void, ProvisionError> =>
  Effect.gen(function* () {
    const branch = ticketBranch(ticketId);
    const remote = "origin";

    const remoteExists = yield* gitHost
      .remoteBranchExists({
        cwd: sandbox.cwd,
        branch,
        remote,
        env,
      })
      .pipe(Effect.mapError(mapGitHostError));
    const openPr = yield* gitHost
      .findOpenPullRequest({
        cwd: sandbox.cwd,
        head: branch,
        env,
      })
      .pipe(Effect.mapError(mapGitHostError));

    yield* refuseTicketBranchCollision({
      branch,
      remote,
      remoteExists,
      openPrUrl: openPr?.url ?? null,
    });

    const checkout = yield* execOrProvisionFail(
      sandbox,
      "git",
      ["checkout", "-B", branch],
      "git checkout"
    );
    yield* requireZero(checkout, `git checkout -B ${branch}`);

    yield* runLockedInstall(sandbox);
  });

export class WorkspaceProvision extends Context.Service<
  WorkspaceProvision,
  WorkspaceProvisionService
>()("@lazy-software-factory/adw/WorkspaceProvision") {
  /** No-op for unit tests that isolate later ADW stages. */
  static readonly Stub = Layer.succeed(
    WorkspaceProvision,
    WorkspaceProvision.of({
      provision: () => Effect.void,
    })
  );

  /**
   * Host / warm-sandbox provision (ADR-0010): reuse `.git` when present;
   * otherwise clone via {@link GitHost}, then ticket branch + locked install.
   */
  static readonly Host = Layer.effect(
    WorkspaceProvision,
    Effect.gen(function* () {
      const gitHost = yield* GitHost;

      return WorkspaceProvision.of({
        provision: ({ sandbox, ticketId, repoUrl, startingRef, env }) =>
          Effect.gen(function* () {
            const gitDir = yield* execOrProvisionFail(
              sandbox,
              "git",
              ["rev-parse", "--git-dir"],
              "git rev-parse"
            );

            if (gitDir.exitCode !== 0) {
              if (!repoUrl) {
                return yield* new ProvisionError({
                  message:
                    "No git worktree and no repoUrl for clone; pass repoUrl for empty sandbox",
                });
              }
              yield* gitHost
                .clone({
                  repoUrl,
                  destination: sandbox.cwd,
                  ...(startingRef ? { ref: startingRef } : {}),
                  env,
                })
                .pipe(
                  Effect.mapError(
                    (err: GitHostError) =>
                      new ProvisionError({
                        message: `git host clone failed: ${err.message}`,
                        cause: err,
                      })
                  )
                );
            } else if (startingRef) {
              const checkoutRef = yield* execOrProvisionFail(
                sandbox,
                "git",
                ["checkout", startingRef],
                "git checkout startingRef"
              );
              yield* requireZero(checkoutRef, `git checkout ${startingRef}`);
            }

            yield* checkoutBranchAndInstall(sandbox, ticketId, gitHost, env);
          }),
      });
    })
  );
}
