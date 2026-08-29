#!/usr/bin/env bash
# Build the local ADW runner image from the Factory lockfile + pinned Node digest.
# Bundles the worker on the host (reproducible deps), then packages a slim runtime image.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/packages/adw-worker/runner/image-pins.env"
cd "$ROOT"

ENTRY="${ADW_RUNNER_ENTRY:-packages/adw/src/adw-worker-main.ts}"
REQUIRE_CURSOR=1
if [[ "${ADW_RUNNER_DETERMINISTIC:-}" == "1" ]]; then
  ENTRY="packages/adw/src/adw-worker-deterministic-main.ts"
  REQUIRE_CURSOR=0
fi

case "$(uname -m)" in
  x86_64 | amd64) LINUX_NATIVE="sdk-linux-x64" ;;
  aarch64 | arm64) LINUX_NATIVE="sdk-linux-arm64" ;;
  *)
    echo "error: unsupported host arch '$(uname -m)' for ADW runner linux natives" >&2
    exit 1
    ;;
esac

mkdir -p packages/adw-worker/runner/dist
# Stage Cursor SDK production closure as real directories (pnpm store symlinks are
# outside the Docker context allowlist — never ship dangling or host-store links).
rm -rf packages/adw-worker/runner/dist/cursor-mods
mkdir -p packages/adw-worker/runner/dist/cursor-mods
CURSOR_MODS="packages/adw-worker/runner/dist/cursor-mods"
STAGE_SCRIPT="$ROOT/packages/adw-worker/runner/stage-cursor-sdk-deps.mjs"

if [[ "$REQUIRE_CURSOR" == "1" ]]; then
  node "$STAGE_SCRIPT" \
    --root "$ROOT" \
    --dest "$CURSOR_MODS" \
    --linux-native "$LINUX_NATIVE"
else
  # Deterministic image: no Cursor helpers.
  touch "$CURSOR_MODS/.keep"
fi

# Prefer root bin; fall back to esbuild resolved through vite (lockfile transitive).
ESBUILD_BIN="$ROOT/node_modules/.bin/esbuild"
if [[ ! -x "$ESBUILD_BIN" ]]; then
  ESBUILD_BIN="$(
    node --input-type=module -e '
import { createRequire } from "node:module";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
const root = process.argv[1];
const bin = join(root, "node_modules/.bin/esbuild");
if (existsSync(bin)) { console.log(bin); process.exit(0); }
try {
  const vitePkg = realpathSync(join(root, "node_modules/vite/package.json"));
  console.log(createRequire(vitePkg).resolve("esbuild/bin/esbuild"));
} catch {
  process.exit(1);
}
' "$ROOT"
  )" || {
    echo "esbuild not found (Factory lockfile / install required; expected via vite)" >&2
    exit 1
  }
fi
"$ESBUILD_BIN" "$ENTRY" \
  --bundle \
  --platform=node \
  --format=esm \
  --outfile=packages/adw-worker/runner/dist/adw-worker.mjs \
  --banner:js="import { createRequire as __adwCreateRequire } from 'node:module'; const require = __adwCreateRequire(import.meta.url);" \
  --external:@cursor/sdk \
  --external:@cursor/sdk-linux-x64 \
  --external:@cursor/sdk-linux-arm64 \
  --external:@cursor/sdk-darwin-arm64 \
  --external:@cursor/sdk-darwin-x64 \
  --external:@cursor/sdk-win32-x64

docker build \
  --file packages/adw-worker/runner/Dockerfile \
  --build-arg "NODE_IMAGE=${ADW_RUNNER_NODE_IMAGE}" \
  --build-arg "DEBIAN_SNAPSHOT=${ADW_RUNNER_DEBIAN_SNAPSHOT}" \
  --build-arg "CA_CERTIFICATES_VERSION=${ADW_RUNNER_CA_CERTIFICATES_VERSION}" \
  --build-arg "CURL_VERSION=${ADW_RUNNER_CURL_VERSION}" \
  --build-arg "GIT_VERSION=${ADW_RUNNER_GIT_VERSION}" \
  --build-arg "GH_VERSION=${ADW_RUNNER_GH_VERSION}" \
  --build-arg "GH_AMD64_SHA256=${ADW_RUNNER_GH_AMD64_SHA256}" \
  --build-arg "GH_ARM64_SHA256=${ADW_RUNNER_GH_ARM64_SHA256}" \
  --build-arg "ADW_RUNNER_REQUIRE_CURSOR=${REQUIRE_CURSOR}" \
  --build-arg "ADW_RUNNER_LINUX_NATIVE=${LINUX_NATIVE}" \
  --tag "${ADW_RUNNER_IMAGE_TAG}" \
  .

echo "Built ${ADW_RUNNER_IMAGE_TAG}"
