import { Schema } from "effect";

/** Wire protocol version for controller ↔ ADW worker framed messages. */
export const ADW_WORKER_PROTOCOL_VERSION = 1 as const;

export const AdwWorkerProtocolVersionSchema = Schema.Literal(
  ADW_WORKER_PROTOCOL_VERSION
);

/** Closed set of ADW statuses mirrored on the worker wire (ADR-0007 / ADR-0011). */
export const AdwWorkerAdwStatus = {
  Shipped: "shipped",
  Failed: "failed",
  NotImplemented: "not_implemented",
  ReadyForPr: "ready_for_pr",
} as const;
export const AdwWorkerAdwStatusSchema = Schema.Enum(AdwWorkerAdwStatus);
export type AdwWorkerAdwStatus = typeof AdwWorkerAdwStatusSchema.Type;

export const AdwWorkerStep = {
  Provision: "provision",
  Build: "build",
  SeamConfirm: "seam_confirm",
  Test: "test",
  Review: "review",
  Ship: "ship",
} as const;
export const AdwWorkerStepSchema = Schema.Enum(AdwWorkerStep);
export type AdwWorkerStep = typeof AdwWorkerStepSchema.Type;

export const AdwWorkerProgressKind = {
  StepEnter: "step_enter",
  StepResult: "step_result",
  WireMiss: "wire_miss",
} as const;
export const AdwWorkerProgressKindSchema = Schema.Enum(AdwWorkerProgressKind);
export type AdwWorkerProgressKind = typeof AdwWorkerProgressKindSchema.Type;

export const AdwWorkerStepResult = {
  Ok: "ok",
  Fail: "fail",
  Resume: "resume",
  WireResume: "wire_resume",
  BuildResume: "build_resume",
} as const;
export const AdwWorkerStepResultSchema = Schema.Enum(AdwWorkerStepResult);
export type AdwWorkerStepResult = typeof AdwWorkerStepResultSchema.Type;

export const AdwWorkerProgressEventSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal(AdwWorkerProgressKind.StepEnter),
    step: AdwWorkerStepSchema,
    buildAttempts: Schema.optionalKey(Schema.Number),
    reviewAttempts: Schema.optionalKey(Schema.Number),
  }),
  Schema.Struct({
    kind: Schema.Literal(AdwWorkerProgressKind.StepResult),
    step: AdwWorkerStepSchema,
    result: AdwWorkerStepResultSchema,
    buildAttempts: Schema.optionalKey(Schema.Number),
    reviewAttempts: Schema.optionalKey(Schema.Number),
  }),
  Schema.Struct({
    kind: Schema.Literal(AdwWorkerProgressKind.WireMiss),
    reviewAttempts: Schema.Number,
    raw: Schema.String,
  }),
]);
export type AdwWorkerProgressEvent = typeof AdwWorkerProgressEventSchema.Type;

/** Completed Minimal ADW result carried on a `completed` terminal frame. */
export const AdwWorkerAdwResultSchema = Schema.Struct({
  ticketId: Schema.String,
  status: AdwWorkerAdwStatusSchema,
  detail: Schema.optionalKey(Schema.String),
  sandboxId: Schema.optionalKey(Schema.String),
  buildSessionId: Schema.optionalKey(Schema.String),
  reviewSessionId: Schema.optionalKey(Schema.String),
  prUrl: Schema.optionalKey(Schema.String),
});
export type AdwWorkerAdwResult = typeof AdwWorkerAdwResultSchema.Type;

export const AdwWorkerTerminalKind = {
  Completed: "completed",
  Cancelled: "cancelled",
  InfrastructureFailed: "infrastructure_failed",
} as const;
export const AdwWorkerTerminalKindSchema = Schema.Enum(AdwWorkerTerminalKind);
export type AdwWorkerTerminalKind = typeof AdwWorkerTerminalKindSchema.Type;

export const AdwWorkerCapability = {
  CursorLocalAgent: "cursor_local_agent",
  GitHostCli: "git_host_cli",
  WorkspaceExec: "workspace_exec",
  SkillPackMount: "skill_pack_mount",
} as const;
export const AdwWorkerCapabilitySchema = Schema.Enum(AdwWorkerCapability);
export type AdwWorkerCapability = typeof AdwWorkerCapabilitySchema.Type;

export const AdwWorkerIsolation = {
  Host: "host",
  Container: "container",
} as const;
export const AdwWorkerIsolationSchema = Schema.Enum(AdwWorkerIsolation);
export type AdwWorkerIsolation = typeof AdwWorkerIsolationSchema.Type;

export const AdwWorkerEffectiveCapabilitiesSchema = Schema.Struct({
  capabilities: Schema.Array(AdwWorkerCapabilitySchema),
  maxConcurrentLeases: Schema.Number,
  isolation: AdwWorkerIsolationSchema,
});
export type AdwWorkerEffectiveCapabilities =
  typeof AdwWorkerEffectiveCapabilitiesSchema.Type;

export const AdwWorkerRequestSchema = Schema.Struct({
  protocolVersion: AdwWorkerProtocolVersionSchema,
  ticketId: Schema.String,
  prompt: Schema.String,
  cwd: Schema.String,
  repoUrl: Schema.optionalKey(Schema.String),
  env: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
export type AdwWorkerRequest = typeof AdwWorkerRequestSchema.Type;

export const AdwWorkerFrameKind = {
  Progress: "progress",
  Terminal: "terminal",
} as const;
export const AdwWorkerFrameKindSchema = Schema.Enum(AdwWorkerFrameKind);
export type AdwWorkerFrameKind = typeof AdwWorkerFrameKindSchema.Type;

export const AdwWorkerTerminalOutcomeSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal(AdwWorkerTerminalKind.Completed),
    result: AdwWorkerAdwResultSchema,
    effectiveCapabilities: AdwWorkerEffectiveCapabilitiesSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal(AdwWorkerTerminalKind.Cancelled),
    detail: Schema.optionalKey(Schema.String),
    effectiveCapabilities: Schema.optionalKey(
      AdwWorkerEffectiveCapabilitiesSchema
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal(AdwWorkerTerminalKind.InfrastructureFailed),
    detail: Schema.String,
    effectiveCapabilities: Schema.optionalKey(
      AdwWorkerEffectiveCapabilitiesSchema
    ),
  }),
]);
export type AdwWorkerTerminalOutcome =
  typeof AdwWorkerTerminalOutcomeSchema.Type;

export const AdwWorkerFrameSchema = Schema.Union([
  Schema.Struct({
    protocolVersion: AdwWorkerProtocolVersionSchema,
    kind: Schema.Literal(AdwWorkerFrameKind.Progress),
    event: AdwWorkerProgressEventSchema,
  }),
  Schema.Struct({
    protocolVersion: AdwWorkerProtocolVersionSchema,
    kind: Schema.Literal(AdwWorkerFrameKind.Terminal),
    outcome: AdwWorkerTerminalOutcomeSchema,
  }),
]);
export type AdwWorkerFrame = typeof AdwWorkerFrameSchema.Type;

/** Hard requirements the controller asks the provider to satisfy before lease. */
export const AdwWorkerCapabilityRequirementsSchema = Schema.Struct({
  hard: Schema.Array(AdwWorkerCapabilitySchema),
  soft: Schema.optionalKey(Schema.Array(AdwWorkerCapabilitySchema)),
});
export type AdwWorkerCapabilityRequirements =
  typeof AdwWorkerCapabilityRequirementsSchema.Type;

export const defaultMinimalAdwCapabilityRequirements: AdwWorkerCapabilityRequirements =
  {
    hard: [
      AdwWorkerCapability.CursorLocalAgent,
      AdwWorkerCapability.GitHostCli,
      AdwWorkerCapability.WorkspaceExec,
      AdwWorkerCapability.SkillPackMount,
    ],
  };
