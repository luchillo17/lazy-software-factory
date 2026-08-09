import { Schema } from "effect";

/** Closed `_tag` set for Runtime errors (const object + Schema.Enum). */
export const RuntimeErrorTag = {
  SandboxCreateError: "SandboxCreateError",
  SandboxExecError: "SandboxExecError",
  SandboxDestroyError: "SandboxDestroyError",
  SandboxBusyError: "SandboxBusyError",
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

export class AgentError extends Schema.TaggedError<AgentError>()(
  RuntimeErrorTag.AgentError,
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}
