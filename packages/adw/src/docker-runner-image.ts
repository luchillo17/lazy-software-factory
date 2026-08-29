/**
 * Pinned Node 24 LTS base for the ADW runner image.
 * Updating the patch/digest is deliberate maintenance, not floating resolution.
 */
export const ADW_RUNNER_NODE_VERSION = "24.20.0" as const;

/** Official `node:24.20.0-bookworm-slim` multi-arch index digest. */
export const ADW_RUNNER_NODE_IMAGE_DIGEST =
  "sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e" as const;

export const ADW_RUNNER_NODE_IMAGE_REF =
  `node:${ADW_RUNNER_NODE_VERSION}-bookworm-slim@${ADW_RUNNER_NODE_IMAGE_DIGEST}` as const;

/** Local tag produced by the Factory runner image build. */
export const DEFAULT_ADW_RUNNER_IMAGE =
  "lazy-software-factory/adw-worker:local";

/** Override via `ADW_RUNNER_IMAGE` (custom images still must pass handshake). */
export const resolveAdwRunnerImage = (
  env: Readonly<Record<string, string | undefined>> = process.env
): string => env["ADW_RUNNER_IMAGE"] ?? DEFAULT_ADW_RUNNER_IMAGE;
