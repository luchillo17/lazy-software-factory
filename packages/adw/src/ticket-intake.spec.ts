import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";
import {
  TicketIntake,
  TicketIntakeError,
  type ReadyTicket,
} from "./ticket-intake.ts";

const fakeReady = (ticket: ReadyTicket): Layer.Layer<TicketIntake> =>
  Layer.succeed(
    TicketIntake,
    TicketIntake.of({
      loadReadyTicket: () => Effect.succeed(ticket),
    })
  );

const fakeFail = (message: string): Layer.Layer<TicketIntake> =>
  Layer.succeed(
    TicketIntake,
    TicketIntake.of({
      loadReadyTicket: (ref) =>
        Effect.fail(new TicketIntakeError({ message: `${message}: ${ref}` })),
    })
  );

describe("TicketIntake seam", () => {
  it.effect("ready-ticket reference yields ticketId + prompt", () =>
    Effect.gen(function* () {
      const intake = yield* TicketIntake.pipe(
        Effect.provide(
          fakeReady({
            ticketId: "37",
            prompt: "# Title\n\nDo the work",
          })
        )
      );

      const ready = yield* intake.loadReadyTicket("37");
      assert.deepStrictEqual(ready, {
        ticketId: "37",
        prompt: "# Title\n\nDo the work",
      });
    })
  );

  it.effect("missing or not-ready ticket fails clearly", () =>
    Effect.gen(function* () {
      const intake = yield* TicketIntake.pipe(
        Effect.provide(fakeFail("Issue is not ready-for-agent"))
      );

      const result = yield* intake.loadReadyTicket("99").pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(result));
      if (Exit.isFailure(result)) {
        assert.isTrue(
          String(result.cause).includes("Issue is not ready-for-agent: 99")
        );
      }
    })
  );
});
