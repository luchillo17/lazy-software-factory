import {
  ADW_WORKER_PROTOCOL_VERSION,
  AdwWorkerProgressKind,
  AdwWorkerTerminalKind,
  defaultMinimalAdwCapabilityRequirements,
  type AdwWorkerEffectiveCapabilities,
  type AdwWorkerProgressEvent,
  type AdwWorkerTerminalOutcome,
} from "@lazy-software-factory/adw-worker";
import { SandboxProvider } from "@lazy-software-factory/runtime";
import { Cause, Effect, Exit } from "effect";
import {
  AdwProgressKind,
  type AdwProgressEvent,
} from "./adw-progress-event.ts";
import { emitAdwProgress } from "./adw-progress.ts";
import { AdwStatus } from "./enums.ts";
import type {
  MinimalAdwInput,
  MinimalAdwResult,
} from "./run-minimal-adw-graph.ts";

export type {
  MinimalAdwInput,
  MinimalAdwResult,
  MinimalAdwServices,
} from "./run-minimal-adw-graph.ts";
export { runMinimalAdwGraph } from "./run-minimal-adw-graph.ts";

const toAdwProgressEvent = (
  event: AdwWorkerProgressEvent
): AdwProgressEvent => {
  switch (event.kind) {
    case AdwWorkerProgressKind.StepEnter:
      return {
        kind: AdwProgressKind.StepEnter,
        step: event.step,
        ...(event.buildAttempts !== undefined
          ? { buildAttempts: event.buildAttempts }
          : {}),
        ...(event.reviewAttempts !== undefined
          ? { reviewAttempts: event.reviewAttempts }
          : {}),
      };
    case AdwWorkerProgressKind.StepResult:
      return {
        kind: AdwProgressKind.StepResult,
        step: event.step,
        result: event.result,
        ...(event.buildAttempts !== undefined
          ? { buildAttempts: event.buildAttempts }
          : {}),
        ...(event.reviewAttempts !== undefined
          ? { reviewAttempts: event.reviewAttempts }
          : {}),
      };
    case AdwWorkerProgressKind.WireMiss:
      return {
        kind: AdwProgressKind.WireMiss,
        reviewAttempts: event.reviewAttempts,
        raw: event.raw,
      };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
};

const detailFromUnknown = (err: unknown): string => {
  if (err instanceof Error) {
    return err.message;
  }
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return String(err);
};

/** Map a typed worker terminal outcome to the Host operator Minimal ADW result. */
export const minimalAdwResultFromOutcome = (
  outcome: AdwWorkerTerminalOutcome,
  ticketId: string
): MinimalAdwResult => {
  switch (outcome.kind) {
    case AdwWorkerTerminalKind.Completed:
      return { ...outcome.result };
    case AdwWorkerTerminalKind.Cancelled:
      return {
        ticketId,
        status: AdwStatus.Failed,
        detail: outcome.detail
          ? `cancelled: ${outcome.detail}`
          : "cancelled: ADW worker interrupted",
      };
    case AdwWorkerTerminalKind.InfrastructureFailed:
      return {
        ticketId,
        status: AdwStatus.Failed,
        detail: `infrastructure_failed: ${outcome.detail}`,
      };
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
};

export interface MinimalAdwControllerResult {
  readonly outcome: AdwWorkerTerminalOutcome;
  readonly result: MinimalAdwResult;
  readonly effectiveCapabilities?: AdwWorkerEffectiveCapabilities;
}

const infrastructureFailed = (
  ticketId: string,
  detail: string,
  effectiveCapabilities?: AdwWorkerEffectiveCapabilities
): MinimalAdwControllerResult => {
  const outcome: AdwWorkerTerminalOutcome = {
    kind: AdwWorkerTerminalKind.InfrastructureFailed,
    detail,
    ...(effectiveCapabilities ? { effectiveCapabilities } : {}),
  };
  return {
    outcome,
    result: minimalAdwResultFromOutcome(outcome, ticketId),
    ...(effectiveCapabilities ? { effectiveCapabilities } : {}),
  };
};

/**
 * Public Minimal ADW controller: acquire one Sandbox lease and run exactly one
 * versioned ADW worker. Progress frames are forwarded to the configured sink.
 */
export const runMinimalAdwController = (
  input: MinimalAdwInput
): Effect.Effect<MinimalAdwControllerResult, never, SandboxProvider> =>
  Effect.scoped(
    Effect.gen(function* () {
      const sandboxes = yield* SandboxProvider;
      const acquireExit = yield* Effect.exit(
        sandboxes.acquire({
          ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
          env: input.env,
          requirements: defaultMinimalAdwCapabilityRequirements,
        })
      );

      if (Exit.isFailure(acquireExit)) {
        const squashed = Cause.squash(acquireExit.cause);
        return infrastructureFailed(
          input.ticketId,
          detailFromUnknown(squashed)
        );
      }

      const lease = acquireExit.value;

      const workerExit = yield* Effect.exit(
        lease.runWorker(
          {
            protocolVersion: ADW_WORKER_PROTOCOL_VERSION,
            ticketId: input.ticketId,
            prompt: input.prompt,
            cwd: input.cwd ?? lease.cwd,
            ...(input.repoUrl ? { repoUrl: input.repoUrl } : {}),
            ...(input.startingRef ? { startingRef: input.startingRef } : {}),
            ...(input.env ? { env: input.env } : {}),
          },
          {
            onProgress: (event: AdwWorkerProgressEvent) =>
              emitAdwProgress(toAdwProgressEvent(event)),
          }
        )
      );

      const outcome: AdwWorkerTerminalOutcome = Exit.match(workerExit, {
        onSuccess: (value) => value,
        onFailure: (cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return {
              kind: AdwWorkerTerminalKind.Cancelled,
              detail: "ADW worker interrupted",
              effectiveCapabilities: lease.effectiveCapabilities,
            };
          }
          return {
            kind: AdwWorkerTerminalKind.InfrastructureFailed,
            detail: detailFromUnknown(Cause.squash(cause)),
            effectiveCapabilities: lease.effectiveCapabilities,
          };
        },
      });

      // Lease metadata is authoritative for provider limits / unmet soft prefs;
      // the worker terminal frame may echo a subset for protocol completeness.
      const effectiveCapabilities = lease.effectiveCapabilities;
      const result = {
        ...minimalAdwResultFromOutcome(outcome, input.ticketId),
        // Worker-local providers report their own internal id (for example
        // "local"). Operators need the authoritative outer lease id.
        sandboxId: lease.id,
      } satisfies MinimalAdwResult;

      return {
        outcome,
        result,
        effectiveCapabilities,
      } satisfies MinimalAdwControllerResult;
    })
  );

/**
 * Public Minimal ADW entry (controller seam). Returns the operator-facing
 * {@link MinimalAdwResult}; use {@link runMinimalAdwController} when the typed
 * terminal outcome is needed.
 */
export const runMinimalAdw = (
  input: MinimalAdwInput
): Effect.Effect<MinimalAdwResult, never, SandboxProvider> =>
  runMinimalAdwController(input).pipe(Effect.map((r) => r.result));
