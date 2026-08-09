import { assert, describe, it } from "@effect/vitest";
import type { AgentOptions, Run, RunResult, SDKAgent } from "@cursor/sdk";
import { Effect, Layer, Ref } from "effect";
import { BuildAgentProvider } from "./agent-provider.ts";
import {
  CursorBuildAgent,
  makeCursorAgentService,
} from "./cursor-agent-provider.ts";
import { CursorSdk } from "./cursor-sdk.ts";
import type { Sandbox } from "./sandbox.ts";

const fakeSandbox: Sandbox = {
  id: "sandbox-1",
  cwd: "/tmp/repo",
  exec: () => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
  destroy: () => Effect.void,
};

const fakeRun = (result: RunResult): Run =>
  ({
    id: result.id,
    agentId: "agent-1",
    supports: () => true,
    unsupportedReason: () => undefined,
    stream: async function* () {},
    conversation: async () => [],
    wait: async () => result,
    cancel: async () => undefined,
    status: result.status,
    onDidChangeStatus: () => () => undefined,
    result: result.result,
    error: result.error,
  }) as Run;

const fakeAgent = (opts: {
  readonly agentId: string;
  readonly onSend: (prompt: string) => Promise<RunResult>;
  readonly onDispose?: () => void;
}): SDKAgent =>
  ({
    agentId: opts.agentId,
    model: undefined,
    send: async (message: string) => fakeRun(await opts.onSend(message)),
    close: () => undefined,
    reload: async () => undefined,
    [Symbol.asyncDispose]: async () => {
      opts.onDispose?.();
    },
    listArtifacts: async () => [],
    downloadArtifact: async () => Buffer.alloc(0),
    getUsage: async () => ({}) as never,
  }) as SDKAgent;

describe("Cursor AgentProvider", () => {
  it.effect(
    "run maps SDK agentId to opaque sessionId and parses JSON output",
    () =>
      Effect.gen(function* () {
        const creates = yield* Ref.make<AgentOptions[]>([]);
        let disposed = 0;

        const sdkLayer = Layer.succeed(
          CursorSdk,
          CursorSdk.of({
            create: (options) =>
              Effect.gen(function* () {
                yield* Ref.update(creates, (c) => [...c, options]);
                return fakeAgent({
                  agentId: "local-abc",
                  onSend: async () => ({
                    id: "run-1",
                    status: "finished",
                    result: JSON.stringify({ verdict: "pass" }),
                  }),
                  onDispose: () => {
                    disposed += 1;
                  },
                });
              }),
            resume: () => Effect.die("resume unused"),
          })
        );

        const session = yield* Effect.gen(function* () {
          const agent = yield* BuildAgentProvider;
          return yield* agent.run({
            prompt: "build it",
            sandbox: fakeSandbox,
            env: { CURSOR_API_KEY: "test-key" },
            model: "composer-2.5",
          });
        }).pipe(Effect.provide(CursorBuildAgent.pipe(Layer.provide(sdkLayer))));

        assert.strictEqual(session.sessionId, "local-abc");
        assert.deepStrictEqual(session.output, { verdict: "pass" });

        const createOpts = yield* Ref.get(creates);
        assert.strictEqual(createOpts.length, 1);
        assert.strictEqual(createOpts[0]?.apiKey, "test-key");
        assert.deepStrictEqual(createOpts[0]?.local, { cwd: "/tmp/repo" });
        assert.deepStrictEqual(createOpts[0]?.model, { id: "composer-2.5" });
        assert.strictEqual(disposed, 1);
      })
  );

  it.effect(
    "resume uses opaque sessionId with sandbox cwd and per-run api key",
    () =>
      Effect.gen(function* () {
        const resumes = yield* Ref.make<
          Array<{ agentId: string; apiKey?: string; cwd?: string }>
        >([]);

        const sdkLayer = Layer.succeed(
          CursorSdk,
          CursorSdk.of({
            create: () => Effect.die("create unused"),
            resume: (agentId, options) =>
              Effect.gen(function* () {
                yield* Ref.update(resumes, (r) => [
                  ...r,
                  {
                    agentId,
                    apiKey: options?.apiKey,
                    cwd: options?.local?.cwd,
                  },
                ]);
                return fakeAgent({
                  agentId,
                  onSend: async () => ({
                    id: "run-2",
                    status: "finished",
                    result: "plain text",
                  }),
                });
              }),
          })
        );

        const session = yield* Effect.gen(function* () {
          const agent = yield* BuildAgentProvider;
          return yield* agent.resume(
            { sessionId: "local-prior" },
            {
              prompt: "fix tests",
              sandbox: fakeSandbox,
              env: { CURSOR_API_KEY: "resume-key" },
            }
          );
        }).pipe(Effect.provide(CursorBuildAgent.pipe(Layer.provide(sdkLayer))));

        assert.strictEqual(session.sessionId, "local-prior");
        assert.strictEqual(session.output, "plain text");

        const observed = yield* Ref.get(resumes);
        assert.deepStrictEqual(observed, [
          {
            agentId: "local-prior",
            apiKey: "resume-key",
            cwd: "/tmp/repo",
          },
        ]);
      })
  );

  it.effect("run status error yields AgentError", () =>
    Effect.gen(function* () {
      const service = makeCursorAgentService({
        create: () =>
          Effect.succeed(
            fakeAgent({
              agentId: "local-err",
              onSend: async () => ({
                id: "run-err",
                status: "error",
                error: { message: "model blew up" },
              }),
            })
          ),
        resume: () => Effect.die("unused"),
      });

      const result = yield* service
        .run({
          prompt: "x",
          sandbox: fakeSandbox,
          env: { CURSOR_API_KEY: "k" },
        })
        .pipe(Effect.exit);

      assert.strictEqual(result._tag, "Failure");
    })
  );
});
