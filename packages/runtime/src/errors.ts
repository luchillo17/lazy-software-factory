import { Schema } from "effect";

/** Closed `_tag` set for Runtime errors (const object + Schema.Enum). */
export const RuntimeErrorTag = {
  SandboxCreateError: "SandboxCreateError",
  SandboxExecError: "SandboxExecError",
  SandboxDestroyError: "SandboxDestroyError",
  SandboxBusyError: "SandboxBusyError",
  SandboxCapabilityError: "SandboxCapabilityError",
  SandboxWorkerError: "SandboxWorkerError",
  AgentError: "AgentError",
} as const;

export const RuntimeErrorTagSchema = Schema.Enum(RuntimeErrorTag);
export type RuntimeErrorTag = typeof RuntimeErrorTagSchema.Type;

export class SandboxCreateError extends Schema.TaggedError<SandboxCreateError>()(
  RuntimeErrorTag.SandboxCreateError,
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export class SandboxExecError extends Schema.TaggedError<SandboxExecError>()(
  RuntimeErrorTag.SandboxExecError,
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export class SandboxDestroyError extends Schema.TaggedError<SandboxDestroyError>()(
  RuntimeErrorTag.SandboxDestroyError,
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export class SandboxBusyError extends Schema.TaggedError<SandboxBusyError>()(
  RuntimeErrorTag.SandboxBusyError,
  {
    message: Schema.String,
  }
) {}

export class SandboxCapabilityError extends Schema.TaggedError<SandboxCapabilityError>()(
  RuntimeErrorTag.SandboxCapabilityError,
  {
    message: Schema.String,
    missing: Schema.optional(Schema.Array(Schema.String)),
  }
) {}

export class SandboxWorkerError extends Schema.TaggedError<SandboxWorkerError>()(
  RuntimeErrorTag.SandboxWorkerError,
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export class AgentError extends Schema.TaggedError<AgentError>()(
  RuntimeErrorTag.AgentError,
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}
