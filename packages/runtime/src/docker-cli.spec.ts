import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  DOCKER_CACHE_PATH,
  DOCKER_TMP_PATH,
  DOCKER_WORKSPACE_PATH,
  dockerCreateArgs,
  dockerExecInteractiveArgs,
  dockerVolumeCreateArgs,
} from "./docker-argv.ts";
import {
  DockerCli,
  DockerCliError,
  parseDockerJson,
  requireDockerOk,
} from "./docker-cli.ts";

describe("docker argv builders", () => {
  it("create args harden the container without publishing ports or privileges", () => {
    const args = dockerCreateArgs({
      name: "adw-test",
      image: "factory-adw-worker:local",
      mounts: { workspaceVolume: "adw-vol-1" },
    });

    assert.isTrue(args.includes("--read-only"));
    assert.isTrue(args.includes("no-new-privileges:true"));
    assert.isTrue(args.includes("--cap-drop"));
    assert.isTrue(args.includes("ALL"));
    assert.isTrue(args.includes("--init"));
    assert.isFalse(args.some((a) => a === "--privileged"));
    assert.isFalse(args.some((a) => a === "-p" || a.startsWith("--publish")));
    assert.isFalse(
      args.some((a) => a.includes("docker.sock")),
      "must not mount Docker socket"
    );
    assert.isTrue(
      args.some((a) =>
        a.includes(`source=adw-vol-1,target=${DOCKER_WORKSPACE_PATH}`)
      )
    );
    assert.isTrue(args.some((a) => a.startsWith(`${DOCKER_TMP_PATH}:`)));
    assert.isTrue(args.some((a) => a.startsWith(`${DOCKER_CACHE_PATH}:`)));
  });

  it("create args never embed secret-looking env by convention tests", () => {
    const args = dockerCreateArgs({
      name: "adw-test",
      image: "img",
      mounts: { workspaceVolume: "v" },
      env: { ADW_WORKER_DETERMINISTIC: "1" },
    });
    assert.isTrue(args.includes("ADW_WORKER_DETERMINISTIC=1"));
    assert.isFalse(args.some((a) => /CURSOR_API_KEY|GH_TOKEN/i.test(a)));
  });

  it("volume create is labeled", () => {
    assert.deepStrictEqual(
      [...dockerVolumeCreateArgs("adw-vol")],
      ["volume", "create", "--label", "lazy.software.factory.adw=1", "adw-vol"]
    );
  });

  it("exec interactive keeps workdir and streams stdin", () => {
    const args = dockerExecInteractiveArgs({
      container: "c1",
      command: "node",
      args: ["/opt/factory/worker.mjs"],
      workdir: DOCKER_WORKSPACE_PATH,
    });
    assert.deepStrictEqual(
      [...args],
      [
        "exec",
        "--interactive",
        "--workdir",
        DOCKER_WORKSPACE_PATH,
        "c1",
        "node",
        "/opt/factory/worker.mjs",
      ]
    );
  });
});

describe("DockerCli parsing", () => {
  it.effect("parseDockerJson decodes a single object", () =>
    Effect.gen(function* () {
      const parsed = yield* parseDockerJson('{"Id":"abc"}\n', (raw) =>
        Effect.succeed(raw as { Id: string })
      );
      assert.strictEqual(parsed.Id, "abc");
    })
  );

  it.effect("parseDockerJson rejects empty stdout", () =>
    Effect.gen(function* () {
      const result = yield* parseDockerJson("", (raw) =>
        Effect.succeed(raw)
      ).pipe(Effect.exit);
      assert.strictEqual(result._tag, "Failure");
    })
  );

  it.effect("requireDockerOk fails on non-zero exit", () =>
    Effect.gen(function* () {
      const result = yield* requireDockerOk(
        { exitCode: 1, stdout: "", stderr: "boom" },
        "docker volume create"
      ).pipe(Effect.exit);
      assert.strictEqual(result._tag, "Failure");
    })
  );

  it.effect("fake DockerCli records argv without spawning", () => {
    const seen: string[][] = [];
    const fake = Layer.succeed(
      DockerCli,
      DockerCli.of({
        run: ({ args }) =>
          Effect.sync(() => {
            seen.push([...args]);
            return { exitCode: 0, stdout: "vol-id\n", stderr: "" };
          }),
      })
    );
    return Effect.gen(function* () {
      const cli = yield* DockerCli;
      const result = yield* cli.run({ args: dockerVolumeCreateArgs("v1") });
      assert.strictEqual(result.exitCode, 0);
      assert.deepStrictEqual(seen[0], [
        "volume",
        "create",
        "--label",
        "lazy.software.factory.adw=1",
        "v1",
      ]);
    }).pipe(Effect.provide(fake));
  });
});

void DockerCliError;
