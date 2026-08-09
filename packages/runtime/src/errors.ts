import { Schema } from "effect";

export class SandboxCreateError extends Schema.TaggedError<SandboxCreateError>()(
  "SandboxCreateError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export class SandboxExecError extends Schema.TaggedError<SandboxExecError>()(
  "SandboxExecError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export class SandboxDestroyError extends Schema.TaggedError<SandboxDestroyError>()(
  "SandboxDestroyError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export class SandboxBusyError extends Schema.TaggedError<SandboxBusyError>()(
  "SandboxBusyError",
  {
    message: Schema.String,
  }
) {}

export class AgentError extends Schema.TaggedError<AgentError>()("AgentError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
