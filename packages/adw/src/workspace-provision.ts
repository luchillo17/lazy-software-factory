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
   * Deterministic setup before Build (ADR-0010). Happy-path stub succeeds;
   * Host reuse/clone+branch+install lands in follow-up tickets.
   */
  readonly provision: (options: {
    readonly sandbox: Sandbox;
    readonly ticketId: string;
  }) => Effect.Effect<void, ProvisionError>;
}

export class WorkspaceProvision extends Context.Service<
  WorkspaceProvision,
  WorkspaceProvisionService
>()("@lazy-software-factory/adw/WorkspaceProvision") {
  /** No-op stub until Host provision (#8). */
  static readonly Stub = Layer.succeed(
    WorkspaceProvision,
    WorkspaceProvision.of({
      provision: () => Effect.void,
    })
  );
}
