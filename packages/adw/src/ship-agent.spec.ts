import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";
import { AdwStatus } from "./enums.ts";
import { GitHost } from "./git-host.ts";
import { runShipAgent, shipCommitMessage, shipPrBody } from "./ship-agent.ts";

describe("shipCommitMessage", () => {
  it("uses a conventional chore type commitlint accepts", () => {
    assert.match(
      shipCommitMessage("37"),
      /^chore\(adw\): ship pending changes for 37$/
    );
  });
});

describe("shipPrBody", () => {
  it("appends Closes #N when ticketId is a numeric Issue id", () => {
    assert.strictEqual(
      shipPrBody("39", "Lead paragraph about the change."),
      "Lead paragraph about the change.\n\nCloses #39"
    );
  });

  it("leaves body unchanged for non-numeric ticket ids", () => {
    assert.strictEqual(
      shipPrBody("T-SHIP", "Lead paragraph."),
      "Lead paragraph."
    );
  });

  it("does not duplicate an existing closing keyword for that Issue", () => {
    assert.strictEqual(
      shipPrBody("39", "Done.\n\nFixes #39"),
      "Done.\n\nFixes #39"
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
          remoteBranchExists: () => Effect.succeed(false),
          findOpenPullRequest: () => Effect.succeed(null),
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

  it.effect("opens PR with shipPrBody so numeric tickets link the Issue", () =>
    Effect.gen(function* () {
      const bodies = yield* Ref.make<string[]>([]);

      const gitLayer = Layer.succeed(
        GitHost,
        GitHost.of({
          commitWorkingTree: () => Effect.void,
          clone: () => Effect.void,
          push: () => Effect.void,
          openPullRequest: ({ body }) =>
            Effect.gen(function* () {
              yield* Ref.update(bodies, (b) => [...b, body]);
              return { url: "https://example.test/pr/59" };
            }),
          remoteBranchExists: () => Effect.succeed(false),
          findOpenPullRequest: () => Effect.succeed(null),
        })
      );

      const result = yield* runShipAgent({
        ticketId: "39",
        cwd: "/tmp/repo",
        branch: "adw/39",
        prTitle: "docs: extractability",
        prBody: "Adds the note.",
      }).pipe(Effect.provide(gitLayer));

      assert.strictEqual(result.status, AdwStatus.Shipped);
      assert.deepStrictEqual(yield* Ref.get(bodies), [
        shipPrBody("39", "Adds the note."),
      ]);
    })
  );
});
