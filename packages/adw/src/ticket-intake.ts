import { Context, Effect, Schema } from "effect";

/** Tracker-agnostic ready ticket for Minimal ADW input. */
export interface ReadyTicket {
  readonly ticketId: string;
  readonly prompt: string;
}

export class TicketIntakeError extends Schema.TaggedError<TicketIntakeError>()(
  "TicketIntakeError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export interface TicketIntakeService {
  /**
   * Load a ready ticket by tracker reference → `ticketId` + prompt.
   * Missing or not-ready tickets fail with {@link TicketIntakeError}.
   */
  readonly loadReadyTicket: (
    ref: string
  ) => Effect.Effect<ReadyTicket, TicketIntakeError>;
}

/** Tracker-pluggable intake seam (GitHub Issues first; Jira later). */
export class TicketIntake extends Context.Service<
  TicketIntake,
  TicketIntakeService
>()("@lazy-software-factory/adw/TicketIntake") {}
