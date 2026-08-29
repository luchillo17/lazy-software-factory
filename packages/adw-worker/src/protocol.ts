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

/** Honest support reporting for capabilities Docker v1 does not enforce. */
export const AdwWorkerSupportLevel = {
  Unsupported: "unsupported",
  Supported: "supported",
  Unknown: "unknown",
} as const;
export const AdwWorkerSupportLevelSchema = Schema.Enum(AdwWorkerSupportLevel);
export type AdwWorkerSupportLevel = typeof AdwWorkerSupportLevelSchema.Type;

/**
 * Sandbox backend features beyond agent capabilities. Hard requests for an
 * unsupported feature fail before allocation; soft requests surface as unmet.
 */
export const AdwWorkerSandboxFeature = {
  DiskQuota: "disk_quota",
  RetainedWorkspaces: "retained_workspaces",
} as const;
export const AdwWorkerSandboxFeatureSchema = Schema.Enum(
  AdwWorkerSandboxFeature
);
export type AdwWorkerSandboxFeature = typeof AdwWorkerSandboxFeatureSchema.Type;

/** Closed set of numeric resource controls providers may enforce. */
export const AdwWorkerResourceLimitKind = {
  Cpu: "cpu",
  Memory: "memory",
  Pid: "pid",
  Lifetime: "lifetime",
} as const;
export const AdwWorkerResourceLimitKindSchema = Schema.Enum(
  AdwWorkerResourceLimitKind
);
export type AdwWorkerResourceLimitKind =
  typeof AdwWorkerResourceLimitKindSchema.Type;

/**
 * Optional numeric resource limits. Units: `cpu` = fractional cores,
 * `memoryBytes` = bytes, `pidsLimit` = max PIDs, `lifetimeMs` = milliseconds.
 */
export const AdwWorkerResourceLimitsSchema = Schema.Struct({
  cpu: Schema.optionalKey(Schema.Number),
  memoryBytes: Schema.optionalKey(Schema.Number),
  pidsLimit: Schema.optionalKey(Schema.Number),
  lifetimeMs: Schema.optionalKey(Schema.Number),
});
export type AdwWorkerResourceLimits = typeof AdwWorkerResourceLimitsSchema.Type;

export const AdwWorkerEffectiveCapabilitiesSchema = Schema.Struct({
  capabilities: Schema.Array(AdwWorkerCapabilitySchema),
  maxConcurrentLeases: Schema.Number,
  isolation: AdwWorkerIsolationSchema,
  retainedWorkspaces: Schema.optionalKey(AdwWorkerSupportLevelSchema),
  diskQuota: Schema.optionalKey(AdwWorkerSupportLevelSchema),
  /** Resource limits actually applied for this lease (when enforced). */
  limits: Schema.optionalKey(AdwWorkerResourceLimitsSchema),
  /** Soft capability preferences the backend does not provide. */
  unmetSoftCapabilities: Schema.optionalKey(
    Schema.Array(AdwWorkerCapabilitySchema)
  ),
  /** Soft feature preferences the backend does not enforce. */
  unmetSoftFeatures: Schema.optionalKey(
    Schema.Array(AdwWorkerSandboxFeatureSchema)
  ),
  /** Soft limit preferences the backend could not apply. */
  unmetSoftLimits: Schema.optionalKey(
    Schema.Array(AdwWorkerResourceLimitKindSchema)
  ),
});
export type AdwWorkerEffectiveCapabilities =
  typeof AdwWorkerEffectiveCapabilitiesSchema.Type;

export const AdwWorkerRequestSchema = Schema.Struct({
  protocolVersion: AdwWorkerProtocolVersionSchema,
  ticketId: Schema.String,
  prompt: Schema.String,
  cwd: Schema.String,
  repoUrl: Schema.optionalKey(Schema.String),
  /** Optional branch name or commit SHA after clone (Docker remote intake). */
  startingRef: Schema.optionalKey(Schema.String),
  env: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
export type AdwWorkerRequest = typeof AdwWorkerRequestSchema.Type;

/** First stdin line before any secret-bearing request (custom image gate). */
export const AdwWorkerHandshakeKind = {
  Handshake: "handshake",
} as const;
export const AdwWorkerHandshakeKindSchema = Schema.Enum(AdwWorkerHandshakeKind);
export type AdwWorkerHandshakeKind = typeof AdwWorkerHandshakeKindSchema.Type;

export const AdwWorkerHandshakeRequestSchema = Schema.Struct({
  protocolVersion: AdwWorkerProtocolVersionSchema,
  kind: AdwWorkerHandshakeKindSchema,
});
export type AdwWorkerHandshakeRequest =
  typeof AdwWorkerHandshakeRequestSchema.Type;

export const AdwWorkerFrameKind = {
  HandshakeOk: "handshake_ok",
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
    kind: Schema.Literal(AdwWorkerFrameKind.HandshakeOk),
  }),
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

/**
 * Hard requirements and soft preferences the controller asks the provider to
 * satisfy before lease. Unsupported hard items fail before allocation;
 * unsupported soft items remain visible on effective metadata.
 */
export const AdwWorkerCapabilityRequirementsSchema = Schema.Struct({
  hard: Schema.Array(AdwWorkerCapabilitySchema),
  soft: Schema.optionalKey(Schema.Array(AdwWorkerCapabilitySchema)),
  hardFeatures: Schema.optionalKey(Schema.Array(AdwWorkerSandboxFeatureSchema)),
  softFeatures: Schema.optionalKey(Schema.Array(AdwWorkerSandboxFeatureSchema)),
  hardLimits: Schema.optionalKey(AdwWorkerResourceLimitsSchema),
  softLimits: Schema.optionalKey(AdwWorkerResourceLimitsSchema),
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
