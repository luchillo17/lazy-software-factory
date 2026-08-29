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
# Stage Cursor SDK + linux natives as real directories (pnpm store symlinks are outside
# the Docker context allowlist — never ship dangling links).
rm -rf packages/adw-worker/runner/dist/cursor-mods
mkdir -p packages/adw-worker/runner/dist/cursor-mods
CURSOR_MODS="packages/adw-worker/runner/dist/cursor-mods"

resolve_cursor_sdk_dir() {
  local candidate
  for candidate in \
    "packages/runtime/node_modules/@cursor/sdk" \
    "node_modules/@cursor/sdk"; do
    if [[ -e "$candidate" ]]; then
      readlink -f "$candidate"
      return 0
    fi
  done
  return 1
}

if [[ "$REQUIRE_CURSOR" == "1" ]]; then
  SDK_DIR=""
  if ! SDK_DIR="$(resolve_cursor_sdk_dir)"; then
    echo "error: @cursor/sdk not found under node_modules or packages/runtime/node_modules" >&2
    echo "error: run pnpm install from the Factory root (lockfile) before building the runner image" >&2
    exit 1
  fi
  # .../.pnpm/@cursor+sdk@VER/node_modules/@cursor/sdk → .../node_modules
  PNPM_NM="$(cd "$SDK_DIR/../.." && pwd)"
  if [[ ! -d "$PNPM_NM/@cursor/sdk" ]]; then
    echo "error: expected pnpm layout at $PNPM_NM/@cursor/sdk (got SDK_DIR=$SDK_DIR)" >&2
    exit 1
  fi
  # Dereference pnpm symlinks so COPY includes real package trees + transitive deps.
  cp -aL "$PNPM_NM/." "$CURSOR_MODS/"

  if [[ -L "$CURSOR_MODS/@cursor/sdk" ]] || [[ ! -f "$CURSOR_MODS/@cursor/sdk/package.json" ]]; then
    echo "error: staged @cursor/sdk must be a real directory with package.json" >&2
    exit 1
  fi
  if [[ -L "$CURSOR_MODS/@cursor/$LINUX_NATIVE" ]] || [[ ! -f "$CURSOR_MODS/@cursor/$LINUX_NATIVE/package.json" ]]; then
    echo "error: staged @cursor/$LINUX_NATIVE missing or still a symlink (linux native helpers required)" >&2
    exit 1
  fi

  # Drop non-target platform packages (darwin/win32/other linux) to keep the image lean.
  find "$CURSOR_MODS/@cursor" -mindepth 1 -maxdepth 1 \( -type d -o -type l \) -name 'sdk-*' ! -name "$LINUX_NATIVE" -exec rm -rf {} +

  DANGLING="$(find "$CURSOR_MODS" -type l ! -exec test -e {} \; -print || true)"
  if [[ -n "$DANGLING" ]]; then
    echo "error: dangling symlinks in cursor-mods staging (Docker context cannot follow them):" >&2
    echo "$DANGLING" >&2
    exit 1
  fi

  if ! NODE_PATH="$CURSOR_MODS" node -e "require.resolve('@cursor/sdk')"; then
    echo "error: staged @cursor/sdk is not resolvable via NODE_PATH=$CURSOR_MODS" >&2
    exit 1
  fi
else
  # Deterministic image: no Cursor helpers.
  :
fi
# Keep COPY happy when deterministic (empty dir marker).
touch "$CURSOR_MODS/.keep"

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
  --build-arg "ADW_RUNNER_REQUIRE_CURSOR=${REQUIRE_CURSOR}" \
  --build-arg "ADW_RUNNER_LINUX_NATIVE=${LINUX_NATIVE}" \
  --tag "${ADW_RUNNER_IMAGE_TAG}" \
  .

echo "Built ${ADW_RUNNER_IMAGE_TAG}"
