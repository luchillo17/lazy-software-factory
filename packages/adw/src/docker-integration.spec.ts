/**
 * Real-container Docker integration (#85):
 * - build runner image once
 * - one Minimal ADW → Ship + leak check
 * - ≥2 concurrent Minimal ADWs → Ship + isolation + leak check
 * - cancellation releases container/volume/slot
 *
 * Fails clearly when Docker is unavailable (never silent-skip success).
 */
import { assert, describe, it } from "@effect/vitest";
import {
  AdwWorkerCapability,
  AdwWorkerIsolation,
  AdwWorkerSupportLevel,
  AdwWorkerTerminalKind,
} from "@lazy-software-factory/adw-worker";
import {
  dockerSandboxProviderLayer,
  DockerCli,
  DOCKER_WORKSPACE_PATH,
  requireDockerOk,
  SandboxProvider,
} from "@lazy-software-factory/runtime";
import { Effect, Fiber, Layer } from "effect";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AdwProgressStderrLive } from "./adw-progress.ts";
import {
  DEFAULT_ADW_RUNNER_IMAGE,
  resolveAdwRunnerImage,
} from "./docker-runner-image.ts";
import { AdwStatus } from "./enums.ts";
import { monorepoRoot } from "./monorepo-root.ts";
import { runMinimalAdwController } from "./run-minimal-adw.ts";

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

const requireDockerDaemon = (): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!dockerAvailable()) {
      throw new Error(
        "Docker daemon unavailable: real-container integration requires Docker (refusing to skip as success)"
      );
    }
  });

let imageBuilt = false;

const buildRunnerImageOnce = (): void => {
  process.env["ADW_RUNNER_DETERMINISTIC"] = "1";
  if (imageBuilt) {
    return;
  }
  const script = resolve(
    monorepoRoot,
    "packages/adw-worker/runner/build-image.sh"
  );
  execFileSync("bash", [script], {
    cwd: monorepoRoot,
    stdio: "inherit",
    timeout: 600_000,
  });
  imageBuilt = true;
};

const dockerProviderLayer = (image: string) =>
  Layer.mergeAll(
    dockerSandboxProviderLayer({
      image,
      maxConcurrentLeases: 4,
      defaultLimits: {
        cpu: 1,
        memoryBytes: 512 * 1024 * 1024,
        pidsLimit: 256,
      },
      containerEnv: {},
    }),
    AdwProgressStderrLive
  );

const assertNoAdwLeaks = (): Effect.Effect<void> =>
  Effect.gen(function* () {
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
      "ADW containers must be removed"
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
      "ADW volumes must be removed"
    );
  }).pipe(Effect.provide(DockerCli.layer()));

const containerNameForLease = (leaseId: string): string =>
  `lsf-adw-${leaseId.replaceAll("-", "").slice(0, 12)}`;

describe("Docker real-container Minimal ADW", () => {
  it.live(
    "one isolated ADW reaches Ship and releases container + volume",
    () =>
      Effect.gen(function* () {
        yield* requireDockerDaemon();
        yield* Effect.sync(buildRunnerImageOnce);

        const image = resolveAdwRunnerImage();
        const controlled = yield* runMinimalAdwController({
          ticketId: "84",
          prompt: "deterministic docker ship",
          repoUrl: "https://example.test/deterministic.git",
        }).pipe(Effect.provide(dockerProviderLayer(image)));

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
        assert.strictEqual(controlled.effectiveCapabilities?.limits?.cpu, 1);

        yield* assertNoAdwLeaks();
      }),
    { timeout: 900_000 }
  );

  it.live(
    "two concurrent Minimal ADWs reach Ship in separate containers",
    () =>
      Effect.gen(function* () {
        yield* requireDockerDaemon();
        yield* Effect.sync(buildRunnerImageOnce);

        const image = resolveAdwRunnerImage();
        const layer = dockerProviderLayer(image);

        const fiber = yield* Effect.forkChild(
          Effect.all(
            [
              runMinimalAdwController({
                ticketId: "85a",
                prompt: "concurrent docker ship a",
                repoUrl: "https://example.test/deterministic-a.git",
              }),
              runMinimalAdwController({
                ticketId: "85b",
                prompt: "concurrent docker ship b",
                repoUrl: "https://example.test/deterministic-b.git",
              }),
            ],
            { concurrency: 2 }
          ).pipe(Effect.provide(layer))
        );

        // While both run, prove distinct live containers (and thus volumes).
        yield* Effect.sleep("400 millis");
        const cli = yield* DockerCli;
        const live = yield* cli.run({
          args: [
            "ps",
            "--quiet",
            "--filter",
            "label=lazy.software.factory.adw=1",
          ],
        });
        yield* requireDockerOk(live, "concurrent docker ps");
        const liveIds = live.stdout
          .trim()
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        assert.isTrue(
          liveIds.length >= 2,
          `expected ≥2 concurrent ADW containers, saw ${liveIds.length}`
        );

        const [a, b] = yield* Fiber.join(fiber);

        assert.strictEqual(a.outcome.kind, AdwWorkerTerminalKind.Completed);
        assert.strictEqual(b.outcome.kind, AdwWorkerTerminalKind.Completed);
        assert.strictEqual(a.result.status, AdwStatus.Shipped);
        assert.strictEqual(b.result.status, AdwStatus.Shipped);
        assert.strictEqual(a.result.ticketId, "85a");
        assert.strictEqual(b.result.ticketId, "85b");
        assert.strictEqual(
          a.effectiveCapabilities?.isolation,
          AdwWorkerIsolation.Container
        );
        assert.strictEqual(
          b.effectiveCapabilities?.isolation,
          AdwWorkerIsolation.Container
        );
        assert.strictEqual(a.effectiveCapabilities?.limits?.cpu, 1);
        assert.strictEqual(b.effectiveCapabilities?.limits?.cpu, 1);

        yield* assertNoAdwLeaks();
      }).pipe(Effect.provide(DockerCli.layer())),
    { timeout: 900_000 }
  );

  it.live(
    "isolation: peer workspace and host sentinel are not reachable",
    () =>
      Effect.gen(function* () {
        yield* requireDockerDaemon();
        yield* Effect.sync(buildRunnerImageOnce);

        const image = resolveAdwRunnerImage();
        const sentinelDir = yield* Effect.tryPromise(() =>
          mkdtemp(join(tmpdir(), "adw-host-sentinel-"))
        );
        const sentinelPath = join(sentinelDir, "SECRET");
        yield* Effect.tryPromise(() =>
          writeFile(sentinelPath, "host-secret-must-not-leak", "utf8")
        );

        const layer = dockerSandboxProviderLayer({
          image,
          maxConcurrentLeases: 4,
        });

        yield* Effect.scoped(
          Effect.gen(function* () {
            const provider = yield* SandboxProvider;
            const leaseA = yield* provider.acquire({
              requirements: {
                hard: [AdwWorkerCapability.WorkspaceExec],
              },
            });
            const leaseB = yield* provider.acquire({
              requirements: {
                hard: [AdwWorkerCapability.WorkspaceExec],
              },
            });
            assert.notStrictEqual(leaseA.id, leaseB.id);

            const cli = yield* DockerCli;
            const nameA = containerNameForLease(leaseA.id);
            const nameB = containerNameForLease(leaseB.id);

            const writeA = yield* cli.run({
              args: [
                "exec",
                nameA,
                "sh",
                "-c",
                `printf 'peer-a' > ${DOCKER_WORKSPACE_PATH}/marker-a`,
              ],
            });
            yield* requireDockerOk(writeA, "write marker in A");

            const readPeer = yield* cli.run({
              args: [
                "exec",
                nameB,
                "sh",
                "-c",
                `cat ${DOCKER_WORKSPACE_PATH}/marker-a`,
              ],
            });
            assert.notStrictEqual(
              readPeer.exitCode,
              0,
              "B must not observe A's workspace marker"
            );

            const hostProbe = yield* cli.run({
              args: [
                "exec",
                nameA,
                "sh",
                "-c",
                `cat ${sentinelPath} 2>/dev/null || true; test -f ${sentinelPath}`,
              ],
            });
            assert.notStrictEqual(
              hostProbe.exitCode,
              0,
              "container must not see host sentinel path"
            );

            // Host source path must not be bind-mounted at workspace.
            const mountProbe = yield* cli.run({
              args: ["inspect", "--format", "{{json .Mounts}}", nameA],
            });
            yield* requireDockerOk(mountProbe, "inspect mounts");
            assert.isFalse(
              mountProbe.stdout.includes(sentinelDir),
              "host sentinel directory must not appear in mounts"
            );
            assert.isFalse(
              /"Type"\s*:\s*"bind"/i.test(mountProbe.stdout) &&
                mountProbe.stdout.includes(monorepoRoot),
              "Factory host checkout must not be bind-mounted"
            );
          })
        ).pipe(Effect.provide(layer), Effect.provide(DockerCli.layer()));

        yield* assertNoAdwLeaks();
      }),
    { timeout: 300_000 }
  );

  it.live(
    "cancellation stops worker and releases container, volume, and capacity slot",
    () =>
      Effect.gen(function* () {
        yield* requireDockerDaemon();
        yield* Effect.sync(buildRunnerImageOnce);

        const image = resolveAdwRunnerImage();
        // Hang after handshake so cancel exercises SIGTERM→SIGKILL + release.
        const hangWorker =
          "const rl=require('node:readline').createInterface({input:process.stdin,terminal:false});" +
          "rl.on('line',(line)=>{if(line.includes('\"handshake\"')){process.stdout.write(" +
          "JSON.stringify({protocolVersion:1,kind:'handshake_ok'})+'\\n');}else{setTimeout(()=>{},6e4);}});";
        const layer = dockerSandboxProviderLayer({
          image,
          maxConcurrentLeases: 1,
          terminateGrace: "1 seconds",
          workerCommand: "node",
          workerArgs: ["-e", hangWorker],
        });

        const fiber = yield* Effect.forkChild(
          Effect.scoped(
            Effect.gen(function* () {
              const provider = yield* SandboxProvider;
              const lease = yield* provider.acquire({
                requirements: {
                  hard: [AdwWorkerCapability.WorkspaceExec],
                },
              });
              return yield* lease.runWorker(
                {
                  protocolVersion: 1,
                  ticketId: "85-cancel",
                  prompt: "hang",
                  cwd: DOCKER_WORKSPACE_PATH,
                },
                { onProgress: () => Effect.void }
              );
            })
          ).pipe(Effect.provide(layer))
        );

        yield* Effect.sleep("800 millis");
        yield* Fiber.interrupt(fiber);
        yield* Fiber.await(fiber);

        // Capacity slot free again (maxConcurrentLeases: 1).
        yield* Effect.scoped(
          Effect.gen(function* () {
            const provider = yield* SandboxProvider;
            const again = yield* provider.acquire({
              requirements: {
                hard: [AdwWorkerCapability.WorkspaceExec],
              },
            });
            assert.isString(again.id);
          })
        ).pipe(Effect.provide(layer));

        yield* assertNoAdwLeaks();
      }),
    { timeout: 300_000 }
  );
});

void DEFAULT_ADW_RUNNER_IMAGE;
