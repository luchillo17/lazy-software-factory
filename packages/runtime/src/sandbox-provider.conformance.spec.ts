/**
 * Host + Docker (fake CLI) entry points for the shared SandboxProvider
 * conformance suite. Documented capability differences are asserted via
 * ConformanceExpectations — not by forking the suite.
 */
import { describe } from "@effect/vitest";
import {
  AdwWorkerIsolation,
  AdwWorkerSupportLevel,
} from "@lazy-software-factory/adw-worker";
import { NodeCrypto } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { DockerCli } from "./docker-cli.ts";
import { makeDockerSandboxProviderLayer } from "./docker-sandbox.ts";
import { describeSandboxProviderConformance } from "./sandbox-provider.conformance.ts";
import { SandboxProvider } from "./sandbox-provider.ts";

describe("provider conformance wiring", () => {
  // Host: full suite including stub worker run + cancel.
  describeSandboxProviderConformance({
    name: "Host",
    layer: SandboxProvider.host({
      workerLaunch: {
        command: process.execPath,
        args: ["--version"], // replaced per-test via withStubWorkerLayer
      },
      terminateGrace: "1 seconds",
    }),
    expectations: {
      isolation: AdwWorkerIsolation.Host,
      maxConcurrentLeases: 1,
      supportsParallelAllocation: false,
      supportsResourceLimits: false,
      diskQuota: AdwWorkerSupportLevel.Unsupported,
      retainedWorkspaces: AdwWorkerSupportLevel.Unsupported,
      runWorkerTests: true,
    },
    withStubWorkerLayer: (stubPath) =>
      SandboxProvider.host({
        workerLaunch: {
          command: process.execPath,
          args: [stubPath],
        },
        terminateGrace: "1 seconds",
      }),
  });

  // Docker fake CLI: allocation / requirements / capacity / metadata only.
  // Live worker concurrency is covered by packages/adw docker-integration.
  const dockerFakeLayer = makeDockerSandboxProviderLayer({
    image: "factory-adw-worker:conformance",
    maxConcurrentLeases: 2,
  }).pipe(
    Layer.provide(NodeCrypto.layer),
    Layer.provide(
      Layer.succeed(
        DockerCli,
        DockerCli.of({
          run: ({ args }) =>
            Effect.succeed(
              args[0] === "create" || args[0] === "start"
                ? { exitCode: 0, stdout: "cid\n", stderr: "" }
                : args[0] === "volume" && args[1] === "create"
                  ? {
                      exitCode: 0,
                      stdout: `${args[args.length - 1]}\n`,
                      stderr: "",
                    }
                  : { exitCode: 0, stdout: "", stderr: "" }
            ),
        })
      )
    )
  );

  describeSandboxProviderConformance({
    name: "Docker (fake CLI)",
    layer: dockerFakeLayer,
    expectations: {
      isolation: AdwWorkerIsolation.Container,
      maxConcurrentLeases: 2,
      supportsParallelAllocation: true,
      supportsResourceLimits: true,
      diskQuota: AdwWorkerSupportLevel.Unsupported,
      retainedWorkspaces: AdwWorkerSupportLevel.Unsupported,
      runWorkerTests: false,
    },
  });
});
