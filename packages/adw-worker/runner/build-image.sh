#!/usr/bin/env bash
# Build the local ADW runner image from the Factory lockfile + pinned Node digest.
# Bundles the worker on the host (reproducible deps), then packages a slim runtime image.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/packages/adw-worker/runner/image-pins.env"
cd "$ROOT"

ENTRY="${ADW_RUNNER_ENTRY:-packages/adw/src/adw-worker-main.ts}"
if [[ "${ADW_RUNNER_DETERMINISTIC:-}" == "1" ]]; then
  ENTRY="packages/adw/src/adw-worker-deterministic-main.ts"
fi

mkdir -p packages/adw-worker/runner/dist
# Stage optional Cursor platform packages for non-deterministic images.
rm -rf packages/adw-worker/runner/dist/cursor-mods
mkdir -p packages/adw-worker/runner/dist/cursor-mods
if [[ "${ADW_RUNNER_DETERMINISTIC:-}" != "1" ]]; then
  CURSOR_SRC=""
  if [[ -d node_modules/@cursor ]]; then
    CURSOR_SRC="node_modules/@cursor"
  elif [[ -d packages/runtime/node_modules/@cursor ]]; then
    CURSOR_SRC="packages/runtime/node_modules/@cursor"
  fi
  if [[ -n "$CURSOR_SRC" ]]; then
    cp -a "$CURSOR_SRC" packages/adw-worker/runner/dist/cursor-mods/
  fi
fi
# Keep COPY happy when no cursor mods: empty dir marker
touch packages/adw-worker/runner/dist/cursor-mods/.keep

ESBUILD_BIN="$ROOT/node_modules/.bin/esbuild"
if [[ ! -x "$ESBUILD_BIN" ]]; then
  echo "esbuild not found at $ESBUILD_BIN (Factory lockfile / install required)" >&2
  exit 1
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
  --tag "${ADW_RUNNER_IMAGE_TAG}" \
  .

echo "Built ${ADW_RUNNER_IMAGE_TAG}"
