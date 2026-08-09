import {
  BuildAgentProvider,
  ReviewAgentProvider,
  RuntimeErrorTag,
  SandboxProvider,
  type AgentSession,
} from "@lazy-software-factory/runtime";
import { Effect, Schema } from "effect";
import { AdwBuildAttemptCap } from "./attempt-caps.ts";
import { AdwStatus, AdwStatusSchema, ReviewVerdict } from "./enums.ts";
import { GitHost } from "./git-host.ts";
import { ReviewOutput } from "./review-output.ts";
import { AdwTestCommands } from "./test-commands.ts";
import { WorkspaceProvision } from "./workspace-provision.ts";

/**
 * Minimal ADW (ADR-0007): provision → Build ↔ Test agent → Review → Ship,
 * one warm sandbox per ticket.
 *
 * Build↔Test: Test fail resumes the same Build session (ADR-0009); each
 * create/resume spends a Build attempt (default cap 5).
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

const gateDetail = (gate: {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}) => {
  const parts = [
    `Test agent failed (exit ${gate.exitCode})`,
    gate.stdout ? `stdout:\n${gate.stdout}` : undefined,
    gate.stderr ? `stderr:\n${gate.stderr}` : undefined,
  ].filter((p): p is string => p !== undefined);
  return parts.join("\n");
};

export type MinimalAdwServices =
  | SandboxProvider
  | BuildAgentProvider
  | ReviewAgentProvider
  | GitHost
  | AdwTestCommands
  | WorkspaceProvision
  | AdwBuildAttemptCap;

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
      const { maxAttempts: buildAttemptCap } = yield* AdwBuildAttemptCap;

      const sandbox = yield* sandboxes.create({
        cwd: process.cwd(),
        env: input.env,
      });

      yield* provisioner.provision({
        sandbox,
        ticketId: input.ticketId,
      });

      let buildSession: AgentSession = yield* buildAgent.run({
        prompt: input.prompt,
        sandbox,
        env: input.env,
      });
      let buildAttempts = 1;

      buildTest: while (true) {
        let lastGateDetail = "Test agent failed";
        let allGreen = true;

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
            allGreen = false;
            lastGateDetail = gateDetail(gate);
            break;
          }
        }

        if (allGreen) {
          break buildTest;
        }

        if (buildAttempts >= buildAttemptCap) {
          return {
            ticketId: input.ticketId,
            status: AdwStatus.Failed,
            detail: lastGateDetail,
            sandboxId: sandbox.id,
            buildSessionId: buildSession.sessionId,
          } satisfies MinimalAdwResult;
        }

        buildSession = yield* buildAgent.resume(buildSession, {
          prompt: lastGateDetail,
          sandbox,
          env: input.env,
        });
        buildAttempts += 1;
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
