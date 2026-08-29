/**
 * Deterministic Agent + Git layers for Docker integration tests.
 * Activated when `ADW_WORKER_DETERMINISTIC=1` (non-secret container env).
 */
import {
  BuildAgentProvider,
  ReviewAgentProvider,
} from "@lazy-software-factory/runtime/agent-provider";
import { Effect, Layer } from "effect";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GitHost, GitHostError } from "./git-host.ts";
import { submitReviewPassViaTools } from "./review-tool-test-helpers.ts";
import { AdwTestCommands } from "./test-commands.ts";

const execFileAsync = promisify(execFile);

const seedDeterministicRepo = async (destination: string): Promise<void> => {
  await mkdir(destination, { recursive: true });
  await execFileAsync("git", ["init", destination]);
  await execFileAsync("git", [
    "-C",
    destination,
    "config",
    "user.email",
    "adw@test.local",
  ]);
  await execFileAsync("git", [
    "-C",
    destination,
    "config",
    "user.name",
    "adw-test",
  ]);
  await writeFile(
    join(destination, "package.json"),
    JSON.stringify({
      name: "deterministic-fixture",
      private: true,
      scripts: {
        "type-check": "node -e process.exit(0)",
        "test:run": "node -e process.exit(0)",
      },
    }),
    "utf8"
  );
  await mkdir(join(destination, ".agents/skills/implement"), {
    recursive: true,
  });
  await writeFile(
    join(destination, ".agents/skills/implement/SKILL.md"),
    "# implement\n\nDeterministic fixture skill.\n",
    "utf8"
  );
  await execFileAsync("git", ["-C", destination, "add", "."]);
  await execFileAsync("git", [
    "-C",
    destination,
    "commit",
    "-m",
    "deterministic init",
  ]);
};

export const DeterministicGitHostLive = Layer.succeed(
  GitHost,
  GitHost.of({
    clone: ({ destination, ref }) =>
      Effect.tryPromise({
        try: async () => {
          await seedDeterministicRepo(destination);
          if (ref !== undefined && ref.length > 0) {
            await execFileAsync("git", ["-C", destination, "checkout", ref]);
          }
        },
        catch: (cause) =>
          new GitHostError({
            message: `deterministic clone failed: ${String(cause)}`,
            cause,
          }),
      }),
    commitWorkingTree: () => Effect.void,
    push: () => Effect.void,
    openPullRequest: () =>
      Effect.succeed({ url: "https://example.test/pr/deterministic" }),
    remoteBranchExists: () => Effect.succeed(false),
    findOpenPullRequest: () => Effect.succeed(null),
  })
);

export const DeterministicAgentLive = Layer.mergeAll(
  Layer.succeed(
    BuildAgentProvider,
    BuildAgentProvider.of({
      run: () => Effect.succeed({ sessionId: "build-deterministic" }),
      resume: (session) => Effect.succeed(session),
    })
  ),
  Layer.succeed(
    ReviewAgentProvider,
    ReviewAgentProvider.of({
      run: (options) =>
        Effect.gen(function* () {
          yield* submitReviewPassViaTools(options);
          return { sessionId: "review-deterministic" };
        }),
      resume: (session, options) =>
        Effect.gen(function* () {
          yield* submitReviewPassViaTools(options);
          return session;
        }),
    })
  )
);

export const DeterministicTestCommandsLive = Layer.succeed(
  AdwTestCommands,
  AdwTestCommands.of({
    resolve: () => [{ command: "node", args: ["-e", "process.exit(0)"] }],
  })
);
