/**
 * Real-container Docker integration: build runner image, run one Minimal ADW
 * with deterministic Agent/Git adapters to Ship, assert cleanup.
 *
 * Fails clearly when Docker is unavailable (never silent-skip success).
 */
import { assert, describe, it } from "@effect/vitest";
import {
  AdwWorkerAdwStatus,
  AdwWorkerIsolation,
  AdwWorkerSupportLevel,
  AdwWorkerTerminalKind,
} from "@lazy-software-factory/adw-worker";
import {
  dockerSandboxProviderLayer,
  DockerCli,
  requireDockerOk,
} from "@lazy-software-factory/runtime";
import { Effect, Exit, Layer } from "effect";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ADW_RUNNER_IMAGE,
  resolveAdwRunnerImage,
} from "./docker-runner-image.ts";
import { monorepoRoot } from "./monorepo-root.ts";
import { AdwStatus } from "./enums.ts";
import { runMinimalAdwController } from "./run-minimal-adw.ts";
import { AdwProgressStderrLive } from "./adw-progress.ts";

const dockerAvailable = (): boolean => {
  try {
    execFileSync("docker", ["info"], {
      stdio: "ignore",
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
  }
};

const buildRunnerImage = (): void => {
  const script = resolve(
    monorepoRoot,
    "packages/adw-worker/runner/build-image.sh"
  );
  execFileSync("bash", [script], {
    cwd: monorepoRoot,
    stdio: "inherit",
    timeout: 600_000,
  });
};

describe("Docker real-container Minimal ADW", () => {
  it.live(
    "one isolated ADW reaches Ship and releases container + volume",
    () =>
      Effect.gen(function* () {
        if (!dockerAvailable()) {
          return yield* Effect.die(
            new Error(
              "Docker daemon unavailable: real-container integration requires Docker (refusing to skip as success)"
            )
          );
        }

        yield* Effect.sync(() => {
          process.env["ADW_RUNNER_DETERMINISTIC"] = "1";
          buildRunnerImage();
        });

        const image = resolveAdwRunnerImage();
        const layer = Layer.mergeAll(
          dockerSandboxProviderLayer({
            image,
            // Deterministic entry is baked into the image; no Cursor needed.
            containerEnv: {},
          }),
          AdwProgressStderrLive
        );

        const controlled = yield* runMinimalAdwController({
          ticketId: "84",
          prompt: "deterministic docker ship",
          repoUrl: "https://example.test/deterministic.git",
        }).pipe(Effect.provide(layer));

        assert.strictEqual(
          controlled.outcome.kind,
          AdwWorkerTerminalKind.Completed
        );
        assert.strictEqual(controlled.result.status, AdwStatus.Shipped);
        assert.strictEqual(
          controlled.effectiveCapabilities?.isolation,
          AdwWorkerIsolation.Container
        );
        assert.strictEqual(
          controlled.effectiveCapabilities?.retainedWorkspaces,
          AdwWorkerSupportLevel.Unsupported
        );
        assert.strictEqual(
          controlled.effectiveCapabilities?.diskQuota,
          AdwWorkerSupportLevel.Unsupported
        );

        // Post-run leak check: no Factory ADW containers/volumes left.
        const cli = yield* DockerCli;
        const containers = yield* cli.run({
          args: [
            "ps",
            "--all",
            "--quiet",
            "--filter",
            "label=lazy.software.factory.adw=1",
          ],
        });
        yield* requireDockerOk(containers, "docker ps leak check");
        assert.strictEqual(
          containers.stdout.trim(),
          "",
          "ADW containers must be removed after success"
        );

        const volumes = yield* cli.run({
          args: [
            "volume",
            "ls",
            "--quiet",
            "--filter",
            "label=lazy.software.factory.adw=1",
          ],
        });
        yield* requireDockerOk(volumes, "docker volume ls leak check");
        assert.strictEqual(
          volumes.stdout.trim(),
          "",
          "ADW volumes must be removed after success"
        );
      }).pipe(Effect.provide(DockerCli.layer())),
    { timeout: 900_000 }
  );
});

void DEFAULT_ADW_RUNNER_IMAGE;
void AdwWorkerAdwStatus;
void Exit;
void fileURLToPath;
