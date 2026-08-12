import type {
  AgentOptions,
  RunResult,
  SDKAgent,
  SDKCustomTool,
} from "@cursor/sdk";
import { Config, ConfigProvider, Effect, Layer, Option } from "effect";
import type {
  AgentProviderService,
  AgentRunOptions,
  AgentSession,
} from "./agent-provider.ts";
import {
  AgentProvider,
  BuildAgentProvider,
  ReviewAgentProvider,
} from "./agent-provider.ts";
import {
  CursorSdk,
  CursorSdkLive,
  type CursorSdkService,
} from "./cursor-sdk.ts";
import { DEFAULT_LOCAL_ADW_MODEL } from "./default-local-model.ts";
import { AgentError } from "./errors.ts";

const resolveApiKey = (
  env: Readonly<Record<string, string>> | undefined
): Effect.Effect<string | undefined> => {
  const fromOpts = env?.["CURSOR_API_KEY"];
  if (fromOpts !== undefined && fromOpts !== "") {
    return Effect.succeed(fromOpts);
  }
  return Config.option(Config.string("CURSOR_API_KEY"))
    .parse(ConfigProvider.fromEnvRecord(process.env))
    .pipe(
      Effect.map(Option.getOrUndefined),
      Effect.orElseSucceed(() => undefined)
    );
};

const parseOutput = (text: string | undefined): unknown => {
  if (text === undefined || text === "") {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const disposeAgent = (agent: SDKAgent): Effect.Effect<void> =>
  Effect.promise(async () => {
    try {
      await agent[Symbol.asyncDispose]();
    } catch {
      // best-effort dispose
    }
  });

const waitRun = (
  agent: SDKAgent,
  prompt: string
): Effect.Effect<RunResult, AgentError> =>
  Effect.tryPromise({
    try: async () => {
      const run = await agent.send(prompt);
      return await run.wait();
    },
    catch: (cause) =>
      new AgentError({
        message:
          cause instanceof Error
            ? `agent.send/wait: ${cause.message}`
            : `agent.send/wait: ${String(cause)}`,
        cause,
      }),
  });

const toSession = (
  agentId: string,
  result: RunResult
): Effect.Effect<AgentSession, AgentError> => {
  if (result.status === "error" || result.status === "cancelled") {
    return Effect.fail(
      new AgentError({
        message: `Cursor run ${result.status}: ${result.error?.message ?? result.id}`,
      })
    );
  }
  return Effect.succeed({
    sessionId: agentId,
    output: parseOutput(result.result),
  } satisfies AgentSession);
};

/** Local SDK requires explicit model; prefer call opts, then per-run / process env. */
const resolveModelId = (
  options: AgentRunOptions
): Effect.Effect<string | undefined> => {
  if (options.model !== undefined && options.model !== "") {
    return Effect.succeed(options.model);
  }
  const fromRunEnv =
    options.env?.["ADW_MODEL"] ?? options.env?.["CURSOR_MODEL"];
  if (fromRunEnv !== undefined && fromRunEnv !== "") {
    return Effect.succeed(fromRunEnv);
  }
  return Config.option(Config.string("ADW_MODEL"))
    .parse(ConfigProvider.fromEnvRecord(process.env))
    .pipe(
      Effect.flatMap((opt) =>
        Option.match(opt, {
          onNone: () =>
            Config.option(Config.string("CURSOR_MODEL")).parse(
              ConfigProvider.fromEnvRecord(process.env)
            ),
          onSome: (value) => Effect.succeed(Option.some(value)),
        })
      ),
      Effect.map((opt) => Option.getOrElse(opt, () => DEFAULT_LOCAL_ADW_MODEL)),
      Effect.orElseSucceed(() => DEFAULT_LOCAL_ADW_MODEL)
    );
};

const createOptions = (
  options: AgentRunOptions,
  apiKey: string | undefined,
  modelId: string | undefined
): AgentOptions => ({
  ...(apiKey ? { apiKey } : {}),
  ...(modelId ? { model: { id: modelId } } : {}),
  local: {
    cwd: options.sandbox.cwd,
    ...(options.customTools
      ? { customTools: options.customTools as Record<string, SDKCustomTool> }
      : {}),
  },
});

/** Build AgentProviderService against an injectable CursorSdk. */
export const makeCursorAgentService = (
  sdk: CursorSdkService
): AgentProviderService => ({
  run: (options) =>
    Effect.scoped(
      Effect.gen(function* () {
        const apiKey = yield* resolveApiKey(options.env);
        const modelId = yield* resolveModelId(options);
        const agent = yield* sdk.create(
          createOptions(options, apiKey, modelId)
        );
        yield* Effect.addFinalizer(() => disposeAgent(agent));
        const result = yield* waitRun(agent, options.prompt);
        return yield* toSession(agent.agentId, result);
      })
    ),

  resume: (session, options) =>
    Effect.scoped(
      Effect.gen(function* () {
        const apiKey = yield* resolveApiKey(options.env);
        const modelId = yield* resolveModelId(options);
        const agent = yield* sdk.resume(
          session.sessionId,
          createOptions(options, apiKey, modelId)
        );
        yield* Effect.addFinalizer(() => disposeAgent(agent));
        const result = yield* waitRun(agent, options.prompt);
        return yield* toSession(agent.agentId, result);
      })
    ),
});

/** Cursor SDK → generic AgentProvider (requires CursorSdk). */
export const CursorAgent = Layer.effect(
  AgentProvider,
  Effect.gen(function* () {
    const sdk = yield* CursorSdk;
    return AgentProvider.of(makeCursorAgentService(sdk));
  })
);

/** Cursor SDK → BuildAgentProvider (requires CursorSdk). */
export const CursorBuildAgent = Layer.effect(
  BuildAgentProvider,
  Effect.gen(function* () {
    const sdk = yield* CursorSdk;
    return BuildAgentProvider.of(makeCursorAgentService(sdk));
  })
);

/** Cursor SDK → ReviewAgentProvider (requires CursorSdk). */
export const CursorReviewAgent = Layer.effect(
  ReviewAgentProvider,
  Effect.gen(function* () {
    const sdk = yield* CursorSdk;
    return ReviewAgentProvider.of(makeCursorAgentService(sdk));
  })
);

/** Cursor Build agent with live `@cursor/sdk` process boundary. */
export const CursorBuildAgentLive = CursorBuildAgent.pipe(
  Layer.provide(CursorSdkLive)
);

/** Cursor Review agent with live `@cursor/sdk` process boundary. */
export const CursorReviewAgentLive = CursorReviewAgent.pipe(
  Layer.provide(CursorSdkLive)
);

/** Cursor AgentProvider with live `@cursor/sdk` process boundary. */
export const CursorAgentLive = CursorAgent.pipe(Layer.provide(CursorSdkLive));
