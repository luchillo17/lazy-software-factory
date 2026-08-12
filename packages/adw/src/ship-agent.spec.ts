import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";
import { AdwStatus } from "./enums.ts";
import { GitHost } from "./git-host.ts";
import { runShipAgent, shipCommitMessage } from "./ship-agent.ts";

describe("shipCommitMessage", () => {
  it("uses a conventional chore type commitlint accepts", () => {
    assert.match(
      shipCommitMessage("37"),
      /^chore\(adw\): ship pending changes for 37$/
    );
  });
});

describe("runShipAgent", () => {
  it.effect("passes commitlint-safe message to commitWorkingTree", () =>
    Effect.gen(function* () {
      const messages = yield* Ref.make<string[]>([]);

      const gitLayer = Layer.succeed(
        GitHost,
        GitHost.of({
          commitWorkingTree: ({ message }) =>
            Ref.update(messages, (m) => [...m, message]),
          clone: () => Effect.void,
          push: () => Effect.void,
          openPullRequest: () =>
            Effect.succeed({ url: "https://example.test/pr/1" }),
        })
      );

      const result = yield* runShipAgent({
        ticketId: "37",
        cwd: "/tmp/repo",
        branch: "adw/37",
        prTitle: "feat(adw): TicketIntake",
        prBody: "body",
      }).pipe(Effect.provide(gitLayer));

      assert.strictEqual(result.status, AdwStatus.Shipped);
      assert.deepStrictEqual(yield* Ref.get(messages), [
        shipCommitMessage("37"),
      ]);
    })
  );
});
