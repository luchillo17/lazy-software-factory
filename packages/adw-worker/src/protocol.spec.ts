import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  ADW_WORKER_PROTOCOL_VERSION,
  AdwWorkerAdwStatus,
  AdwWorkerCapability,
  AdwWorkerErrorTag,
  AdwWorkerFrameKind,
  AdwWorkerIsolation,
  AdwWorkerProgressKind,
  AdwWorkerProtocolError,
  AdwWorkerStep,
  AdwWorkerTerminalKind,
  decodeWorkerFrame,
  decodeWorkerHandshake,
  decodeWorkerRequest,
  encodeWorkerFrame,
  encodeWorkerHandshake,
  encodeWorkerRequest,
  redactWorkerDiagnostics,
  AdwWorkerHandshakeKind,
  AdwWorkerResourceLimitKind,
  AdwWorkerSandboxFeature,
  AdwWorkerSupportLevel,
  AdwWorkerCapabilityRequirementsSchema,
  AdwWorkerEffectiveCapabilitiesSchema,
} from "./index.ts";
import { Schema } from "effect";

describe("adw worker protocol framing", () => {
  it.effect("round-trips handshake encode/decode", () =>
    Effect.gen(function* () {
      const line = encodeWorkerHandshake();
      const handshake = yield* decodeWorkerHandshake(line);
      assert.strictEqual(handshake.kind, AdwWorkerHandshakeKind.Handshake);
      assert.strictEqual(
        handshake.protocolVersion,
        ADW_WORKER_PROTOCOL_VERSION
      );
    })
  );

  it.effect("round-trips handshake_ok frame", () =>
    Effect.gen(function* () {
      const line = encodeWorkerFrame({
        protocolVersion: ADW_WORKER_PROTOCOL_VERSION,
        kind: AdwWorkerFrameKind.HandshakeOk,
      });
      const frame = yield* decodeWorkerFrame(line);
      assert.strictEqual(frame.kind, AdwWorkerFrameKind.HandshakeOk);
    })
  );

  it.effect("round-trips a progress frame", () =>
    Effect.gen(function* () {
      const line = encodeWorkerFrame({
        protocolVersion: ADW_WORKER_PROTOCOL_VERSION,
        kind: AdwWorkerFrameKind.Progress,
        event: {
          kind: AdwWorkerProgressKind.StepEnter,
          step: AdwWorkerStep.Provision,
        },
      });
      const frame = yield* decodeWorkerFrame(line);
      assert.strictEqual(frame.kind, AdwWorkerFrameKind.Progress);
      if (frame.kind === AdwWorkerFrameKind.Progress) {
        assert.strictEqual(frame.event.step, AdwWorkerStep.Provision);
      }
    })
  );

  it.effect("round-trips a completed terminal frame", () =>
    Effect.gen(function* () {
      const line = encodeWorkerFrame({
        protocolVersion: ADW_WORKER_PROTOCOL_VERSION,
        kind: AdwWorkerFrameKind.Terminal,
        outcome: {
          kind: AdwWorkerTerminalKind.Completed,
          result: {
            ticketId: "82",
            status: AdwWorkerAdwStatus.Shipped,
            prUrl: "https://example.test/pr/1",
          },
          effectiveCapabilities: {
            capabilities: [AdwWorkerCapability.WorkspaceExec],
            maxConcurrentLeases: 1,
            isolation: AdwWorkerIsolation.Host,
          },
        },
      });
      const frame = yield* decodeWorkerFrame(line);
      assert.strictEqual(frame.kind, AdwWorkerFrameKind.Terminal);
    })
  );

  it.effect("rejects malformed JSON frames", () =>
    Effect.gen(function* () {
      const result = yield* decodeWorkerFrame("not-json").pipe(Effect.exit);
      assert.isTrue(result._tag === "Failure");
    })
  );

  it.effect("rejects unsupported protocol version", () =>
    Effect.gen(function* () {
      const result = yield* decodeWorkerFrame(
        JSON.stringify({
          protocolVersion: 999,
          kind: AdwWorkerFrameKind.Progress,
          event: {
            kind: AdwWorkerProgressKind.StepEnter,
            step: AdwWorkerStep.Provision,
          },
        })
      ).pipe(Effect.exit);
      assert.isTrue(result._tag === "Failure");
      if (result._tag === "Failure") {
        const err = result.cause;
        assert.isTrue(
          String(err).includes("Unsupported worker protocol version") ||
            err._tag === "Fail"
        );
      }
    })
  );

  it.effect("decodes a worker request line", () =>
    Effect.gen(function* () {
      const line = encodeWorkerRequest({
        protocolVersion: ADW_WORKER_PROTOCOL_VERSION,
        ticketId: "82",
        prompt: "implement",
        cwd: "/tmp/repo",
      });
      const request = yield* decodeWorkerRequest(line.trim());
      assert.strictEqual(request.ticketId, "82");
      assert.strictEqual(request.cwd, "/tmp/repo");
    })
  );

  it("redacts secrets from worker diagnostics", () => {
    const redacted = redactWorkerDiagnostics(
      "token=ghp_abcdefghijklmnopqrstuv and CURSOR_API_KEY=secret-value"
    );
    assert.isFalse(redacted.includes("ghp_"));
    assert.isFalse(redacted.includes("secret-value"));
    assert.isTrue(redacted.includes("[REDACTED]"));
  });

  it.effect("TaggedError name for protocol failures", () =>
    Effect.gen(function* () {
      const err = yield* decodeWorkerFrame("").pipe(
        Effect.flip,
        Effect.catch((e) => Effect.succeed(e))
      );
      assert.strictEqual(
        err instanceof AdwWorkerProtocolError ||
          (err as { _tag?: string })._tag ===
            AdwWorkerErrorTag.AdwWorkerProtocolError,
        true
      );
    })
  );
});

describe("adw worker capability requirements + effective metadata", () => {
  it.effect(
    "round-trips requirements with soft prefs and resource limits",
    () =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(
          AdwWorkerCapabilityRequirementsSchema
        )({
          hard: [AdwWorkerCapability.WorkspaceExec],
          soft: [AdwWorkerCapability.SkillPackMount],
          hardFeatures: [AdwWorkerSandboxFeature.DiskQuota],
          softFeatures: [AdwWorkerSandboxFeature.RetainedWorkspaces],
          hardLimits: {
            cpu: 1,
            memoryBytes: 512 * 1024 * 1024,
            pidsLimit: 256,
            lifetimeMs: 60_000,
          },
          softLimits: { cpu: 2 },
        });
        assert.strictEqual(decoded.hardLimits?.cpu, 1);
        assert.strictEqual(
          decoded.hardFeatures?.[0],
          AdwWorkerSandboxFeature.DiskQuota
        );
        assert.strictEqual(
          decoded.soft?.[0],
          AdwWorkerCapability.SkillPackMount
        );
      })
  );

  it.effect("round-trips effective caps with unmet soft + applied limits", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(
        AdwWorkerEffectiveCapabilitiesSchema
      )({
        capabilities: [AdwWorkerCapability.WorkspaceExec],
        maxConcurrentLeases: 32,
        isolation: AdwWorkerIsolation.Container,
        retainedWorkspaces: AdwWorkerSupportLevel.Unsupported,
        diskQuota: AdwWorkerSupportLevel.Unsupported,
        limits: {
          cpu: 1,
          memoryBytes: 268_435_456,
          pidsLimit: 128,
          lifetimeMs: 30_000,
        },
        unmetSoftCapabilities: [AdwWorkerCapability.SkillPackMount],
        unmetSoftFeatures: [AdwWorkerSandboxFeature.DiskQuota],
        unmetSoftLimits: [AdwWorkerResourceLimitKind.Lifetime],
      });
      assert.strictEqual(decoded.limits?.pidsLimit, 128);
      assert.deepStrictEqual(decoded.unmetSoftFeatures, [
        AdwWorkerSandboxFeature.DiskQuota,
      ]);
      assert.deepStrictEqual(decoded.unmetSoftLimits, [
        AdwWorkerResourceLimitKind.Lifetime,
      ]);
    })
  );
});
