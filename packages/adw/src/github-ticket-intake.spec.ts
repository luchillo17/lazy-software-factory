import { GhRunner } from "@lazy-software-factory/git-host";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Layer, Ref } from "effect";
import {
  GitHubTicketIntake,
  ReadyTicketLabel,
} from "./github-ticket-intake.ts";
import { TicketIntake } from "./ticket-intake.ts";

const issueJson = (options: {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
}) =>
  JSON.stringify({
    number: options.number,
    title: options.title,
    body: options.body,
    labels: options.labels.map((name) => ({ name })),
  });

describe("GitHub TicketIntake adapter", () => {
  it.effect("maps ready Issue number to ticketId + prompt via gh", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<
        Array<{ command: string; args: readonly string[] }>
      >([]);

      const fakeCli = Layer.succeed(
        GhRunner,
        GhRunner.of({
          run: ({ command, args }) =>
            Effect.gen(function* () {
              yield* Ref.update(calls, (cs) => [...cs, { command, args }]);
              return {
                exitCode: 0,
                stdout: issueJson({
                  number: 37,
                  title: "TicketIntake seam",
                  body: "Build the adapter",
                  labels: [ReadyTicketLabel.ReadyForAgent],
                }),
                stderr: "",
              };
            }),
        })
      );

      const intake = yield* TicketIntake.pipe(
        Effect.provide(GitHubTicketIntake.pipe(Layer.provide(fakeCli)))
      );

      const ready = yield* intake.loadReadyTicket("37");
      assert.deepStrictEqual(ready, {
        ticketId: "37",
        prompt: "# TicketIntake seam\n\nBuild the adapter",
      });

      const seen = yield* Ref.get(calls);
      assert.deepStrictEqual(seen, [
        {
          command: "gh",
          args: ["issue", "view", "37", "--json", "number,title,body,labels"],
        },
      ]);
    })
  );

  it.effect("accepts #N ref without -R", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<
        Array<{ command: string; args: readonly string[] }>
      >([]);

      const fakeCli = Layer.succeed(
        GhRunner,
        GhRunner.of({
          run: ({ command, args }) =>
            Effect.gen(function* () {
              yield* Ref.update(calls, (cs) => [...cs, { command, args }]);
              return {
                exitCode: 0,
                stdout: issueJson({
                  number: 42,
                  title: "Hash intake",
                  body: "from hash",
                  labels: [ReadyTicketLabel.ReadyForAgent],
                }),
                stderr: "",
              };
            }),
        })
      );

      const intake = yield* TicketIntake.pipe(
        Effect.provide(GitHubTicketIntake.pipe(Layer.provide(fakeCli)))
      );

      const ready = yield* intake.loadReadyTicket("#42");
      assert.strictEqual(ready.ticketId, "42");

      const seen = yield* Ref.get(calls);
      assert.deepStrictEqual(seen, [
        {
          command: "gh",
          args: ["issue", "view", "42", "--json", "number,title,body,labels"],
        },
      ]);
    })
  );

  it.effect("accepts Issue URL with -R owner/repo", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<
        Array<{ command: string; args: readonly string[] }>
      >([]);

      const fakeCli = Layer.succeed(
        GhRunner,
        GhRunner.of({
          run: ({ command, args }) =>
            Effect.gen(function* () {
              yield* Ref.update(calls, (cs) => [...cs, { command, args }]);
              return {
                exitCode: 0,
                stdout: issueJson({
                  number: 42,
                  title: "URL intake",
                  body: "from url",
                  labels: [ReadyTicketLabel.ReadyForAgent],
                }),
                stderr: "",
              };
            }),
        })
      );

      const intake = yield* TicketIntake.pipe(
        Effect.provide(GitHubTicketIntake.pipe(Layer.provide(fakeCli)))
      );

      const ready = yield* intake.loadReadyTicket(
        "https://github.com/example/repo/issues/42"
      );
      assert.strictEqual(ready.ticketId, "42");

      const seen = yield* Ref.get(calls);
      assert.deepStrictEqual(seen, [
        {
          command: "gh",
          args: [
            "issue",
            "view",
            "42",
            "--json",
            "number,title,body,labels",
            "-R",
            "example/repo",
          ],
        },
      ]);
    })
  );

  it.effect("rejects Issue without ready-for-agent", () =>
    Effect.gen(function* () {
      const fakeCli = Layer.succeed(
        GhRunner,
        GhRunner.of({
          run: () =>
            Effect.succeed({
              exitCode: 0,
              stdout: issueJson({
                number: 7,
                title: "Not ready",
                body: "still drafting",
                labels: ["needs-triage"],
              }),
              stderr: "",
            }),
        })
      );

      const intake = yield* TicketIntake.pipe(
        Effect.provide(GitHubTicketIntake.pipe(Layer.provide(fakeCli)))
      );

      const result = yield* intake.loadReadyTicket("7").pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(result));
      if (Exit.isFailure(result)) {
        assert.isTrue(
          String(result.cause).includes(ReadyTicketLabel.ReadyForAgent)
        );
      }
    })
  );

  it.effect("fails clearly when Issue is missing", () =>
    Effect.gen(function* () {
      const fakeCli = Layer.succeed(
        GhRunner,
        GhRunner.of({
          run: () =>
            Effect.succeed({
              exitCode: 1,
              stdout: "",
              stderr: "could not find issue #404",
            }),
        })
      );

      const intake = yield* TicketIntake.pipe(
        Effect.provide(GitHubTicketIntake.pipe(Layer.provide(fakeCli)))
      );

      const result = yield* intake.loadReadyTicket("404").pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(result));
      if (Exit.isFailure(result)) {
        assert.isTrue(String(result.cause).includes("404"));
      }
    })
  );
});
