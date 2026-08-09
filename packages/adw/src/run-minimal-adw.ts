import {
  BuildAgentProvider,
  ReviewAgentProvider,
  RuntimeErrorTag,
  SandboxProvider,
} from "@lazy-software-factory/runtime";
import { Effect, Schema } from "effect";
import { AdwStatus, AdwStatusSchema, ReviewVerdict } from "./enums.ts";
import { GitHost } from "./git-host.ts";
import { ReviewOutput } from "./review-output.ts";
import { AdwTestCommands } from "./test-commands.ts";
import { WorkspaceProvision } from "./workspace-provision.ts";

/**
 * Minimal ADW (ADR-0007): provision → Build → Test agent → Review → Ship,
 * one warm sandbox per ticket.
 *
 * Happy path (#4): stub provision, one Build, green Test, Review pass,
 * push-then-PR → `shipped`. Resume/caps land in follow-ups.
 */
export interface MinimalAdwInput {
  readonly ticketId: string;
  readonly prompt: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface MinimalAdwResult {
  readonly ticketId: string;
  readonly status: typeof AdwStatusSchema.Type;
  readonly detail?: string;
  readonly sandboxId?: string;
  readonly buildSessionId?: string;
  readonly reviewSessionId?: string;
  readonly prUrl?: string;
}

const ticketBranch = (ticketId: string) => `adw/${ticketId}`;

/** Local Test-exec branch tags (not Runtime `_tag` / not ADW status). */
const TestExecBranch = {
  Ok: "ok",
  ExecError: "execError",
} as const;

export type MinimalAdwServices =
  | SandboxProvider
  | BuildAgentProvider
  | ReviewAgentProvider
  | GitHost
  | AdwTestCommands
  | WorkspaceProvision;

export const runMinimalAdw = (
  input: MinimalAdwInput
): Effect.Effect<MinimalAdwResult, never, MinimalAdwServices> =>
  Effect.scoped(
    Effect.gen(function* () {
      const sandboxes = yield* SandboxProvider;
      const buildAgent = yield* BuildAgentProvider;
      const reviewAgent = yield* ReviewAgentProvider;
      const gitHost = yield* GitHost;
      const testCommands = yield* AdwTestCommands;
      const provisioner = yield* WorkspaceProvision;

      const sandbox = yield* sandboxes.create({
        cwd: process.cwd(),
        env: input.env,
      });

      yield* provisioner.provision({
        sandbox,
        ticketId: input.ticketId,
      });

      const buildSession = yield* buildAgent.run({
        prompt: input.prompt,
        sandbox,
        env: input.env,
      });

      for (const step of testCommands.commands) {
        const gateOrError = yield* sandbox
          .exec(step.command, step.args ?? [])
          .pipe(
            Effect.map((gate) => ({
              _tag: TestExecBranch.Ok,
              gate,
            })),
            Effect.catchTag(RuntimeErrorTag.SandboxExecError, (err) =>
              Effect.succeed({
                _tag: TestExecBranch.ExecError,
                message: err.message,
              })
            )
          );
        if (gateOrError._tag === TestExecBranch.ExecError) {
          return {
            ticketId: input.ticketId,
            status: AdwStatus.Failed,
            detail: `Test agent exec error: ${gateOrError.message}`,
            sandboxId: sandbox.id,
            buildSessionId: buildSession.sessionId,
          } satisfies MinimalAdwResult;
        }
        const { gate } = gateOrError;
        if (gate.exitCode !== 0) {
          return {
            ticketId: input.ticketId,
            status: AdwStatus.Failed,
            detail: `Test agent failed (exit ${gate.exitCode}): ${gate.stderr || gate.stdout}`,
            sandboxId: sandbox.id,
            buildSessionId: buildSession.sessionId,
          } satisfies MinimalAdwResult;
        }
      }

      const reviewSession = yield* reviewAgent.run({
        prompt: `Review changes for ticket ${input.ticketId}`,
        sandbox,
        env: input.env,
      });

      const decoded = yield* Schema.decodeUnknownEffect(ReviewOutput)(
        reviewSession.output
      ).pipe(
        Effect.catchTag("SchemaError", () =>
          Effect.succeed({
            verdict: ReviewVerdict.Fail,
            failReport: "malformed or missing Review verdict",
          } satisfies ReviewOutput)
        )
      );

      if (decoded.verdict !== ReviewVerdict.Pass) {
        return {
          ticketId: input.ticketId,
          status: AdwStatus.Failed,
          detail: decoded.failReport ?? "Review failed",
          sandboxId: sandbox.id,
          buildSessionId: buildSession.sessionId,
          reviewSessionId: reviewSession.sessionId,
        } satisfies MinimalAdwResult;
      }

      const branch = ticketBranch(input.ticketId);

      const pushResult = yield* gitHost
        .push({ sandbox, branch })
        .pipe(Effect.exit);

      if (pushResult._tag === "Failure") {
        return {
          ticketId: input.ticketId,
          status: AdwStatus.ReadyForPr,
          detail: "Ship push failed",
          sandboxId: sandbox.id,
          buildSessionId: buildSession.sessionId,
          reviewSessionId: reviewSession.sessionId,
        } satisfies MinimalAdwResult;
      }

      const prResult = yield* gitHost
        .openPullRequest({
          sandbox,
          branch,
          title: `ADW: ${input.ticketId}`,
        })
        .pipe(Effect.exit);

      if (prResult._tag === "Failure") {
        return {
          ticketId: input.ticketId,
          status: AdwStatus.ReadyForPr,
          detail: "Ship open PR failed",
          sandboxId: sandbox.id,
          buildSessionId: buildSession.sessionId,
          reviewSessionId: reviewSession.sessionId,
        } satisfies MinimalAdwResult;
      }

      return {
        ticketId: input.ticketId,
        status: AdwStatus.Shipped,
        sandboxId: sandbox.id,
        buildSessionId: buildSession.sessionId,
        reviewSessionId: reviewSession.sessionId,
        prUrl: prResult.value.url,
      } satisfies MinimalAdwResult;
    }).pipe(
      Effect.catch((err) =>
        Effect.succeed({
          ticketId: input.ticketId,
          status: AdwStatus.Failed,
          detail: err instanceof Error ? err.message : String(err),
        } satisfies MinimalAdwResult)
      )
    )
  );
