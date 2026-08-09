import type { Sandbox } from "@lazy-software-factory/runtime";
import { Context, Effect, Layer, Schema } from "effect";

export class ProvisionError extends Schema.TaggedError<ProvisionError>()(
  "ProvisionError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export interface WorkspaceProvisionService {
  /**
   * Deterministic setup before Build (ADR-0010): ensure git worktree,
   * checkout orchestration-owned ticket branch, locked install when present.
   */
  readonly provision: (options: {
    readonly sandbox: Sandbox;
    readonly ticketId: string;
  }) => Effect.Effect<void, ProvisionError>;
}

const ticketBranch = (ticketId: string) => `adw/${ticketId}`;

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
  {
    lockfile: "package-lock.json",
    command: "npm",
    args: ["ci"],
  },
  {
    lockfile: "yarn.lock",
    command: "yarn",
    args: ["install", "--frozen-lockfile"],
  },
  {
    lockfile: "bun.lockb",
    command: "bun",
    args: ["install", "--frozen-lockfile"],
  },
];

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
   * Host provision (ADR-0010): reuse existing clone when `.git` is present;
   * create/checkout `adw/<ticketId>`; run locked install when a lockfile exists.
   * Missing worktree fails — clone-when-empty is #12.
   */
  static readonly Host = Layer.succeed(
    WorkspaceProvision,
    WorkspaceProvision.of({
      provision: ({ sandbox, ticketId }) =>
        Effect.gen(function* () {
          const gitDir = yield* execOrProvisionFail(
            sandbox,
            "git",
            ["rev-parse", "--git-dir"],
            "git rev-parse"
          );
          if (gitDir.exitCode !== 0) {
            return yield* new ProvisionError({
              message:
                "Host provision requires an existing git worktree (.git); clone-when-empty is separate",
            });
          }

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
            yield* requireZero(
              install,
              `${step.command} ${step.args.join(" ")}`
            );
            return;
          }
        }),
    })
  );
}
