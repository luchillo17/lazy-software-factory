import type { Sandbox } from "@lazy-software-factory/runtime";
import { Context, Effect, Layer, Schema } from "effect";
import { GitHost, GitHostError } from "./git-host.ts";
import { ticketBranch } from "./ticket-branch.ts";

export class ProvisionError extends Schema.TaggedError<ProvisionError>()(
  "ProvisionError",
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
  sandbox.exec(command, args).pipe(
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

/** This monorepo: pnpm lockfile only (ADR-0010). */
const LOCKFILE_INSTALLS: ReadonlyArray<{
  readonly lockfile: string;
  readonly command: string;
  readonly args: readonly string[];
}> = [
  {
    lockfile: "pnpm-lock.yaml",
    command: "pnpm",
    args: ["install", "--frozen-lockfile"],
  },
];

const checkoutBranchAndInstall = (
  sandbox: Sandbox,
  ticketId: string
): Effect.Effect<void, ProvisionError> =>
  Effect.gen(function* () {
    const branch = ticketBranch(ticketId);
    const checkout = yield* execOrProvisionFail(
      sandbox,
      "git",
      ["checkout", "-B", branch],
      "git checkout"
    );
    yield* requireZero(checkout, `git checkout -B ${branch}`);

    for (const step of LOCKFILE_INSTALLS) {
      const lock = yield* execOrProvisionFail(
        sandbox,
        "test",
        ["-f", step.lockfile],
        `test -f ${step.lockfile}`
      );
      if (lock.exitCode !== 0) {
        continue;
      }
      const install = yield* execOrProvisionFail(
        sandbox,
        step.command,
        step.args,
        `${step.command} install`
      );
      yield* requireZero(install, `${step.command} ${step.args.join(" ")}`);
      return;
    }
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
        provision: ({ sandbox, ticketId, repoUrl, env }) =>
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
            }

            yield* checkoutBranchAndInstall(sandbox, ticketId);
          }),
      });
    })
  );
}
