# ADW runner image — generic Node environment (not Nx).
# Worker JS is pre-bundled on the host from the Factory lockfile (build-image.sh).
# Base: exact Node 24 LTS patch + OCI digest (image-pins.env).

ARG NODE_IMAGE=node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    gnupg \
  && curl -fsSL "https://cli.github.com/packages/githubcli-archive-keyring.gpg" \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && groupadd --gid 10001 adw \
  && useradd --uid 10001 --gid adw --create-home --home-dir /home/adw adw \
  && mkdir -p /opt/factory/node_modules /workspace /home/adw/.cache \
  && chown -R adw:adw /opt/factory /workspace /home/adw

# Compiled worker + Review skill pack only (no Nx, tsx, TypeScript sources, or devDeps).
COPY packages/adw-worker/runner/dist/adw-worker.mjs /opt/factory/adw-worker.mjs
COPY packages/adw/host-skill-pack /opt/factory/host-skill-pack
# Cursor SDK + linux natives (real dirs) when building a non-deterministic runner.
COPY packages/adw-worker/runner/dist/cursor-mods/ /opt/factory/node_modules/

ARG ADW_RUNNER_REQUIRE_CURSOR=0
ARG ADW_RUNNER_LINUX_NATIVE=sdk-linux-x64

ENV HOME=/home/adw \
  ADW_HOST_SKILL_PACK_ROOT=/opt/factory/host-skill-pack \
  NODE_PATH=/opt/factory/node_modules \
  npm_config_cache=/workspace/.npm-cache \
  npm_config_store_dir=/home/adw/.cache/pnpm-store \
  XDG_CACHE_HOME=/home/adw/.cache \
  NODE_ENV=production

# Fail the build if Cursor helpers are required but missing/unloadable (symlink-only
# staging used to pass here). Native packages have no "main" — assert on disk.
RUN chown -R adw:adw /opt/factory \
  && ! command -v nx >/dev/null \
  && ! command -v tsx >/dev/null \
  && if [ "${ADW_RUNNER_REQUIRE_CURSOR}" = "1" ]; then \
    node -e "require.resolve('@cursor/sdk')" \
    && test -f "/opt/factory/node_modules/@cursor/${ADW_RUNNER_LINUX_NATIVE}/package.json" \
    && test -d "/opt/factory/node_modules/@cursor/${ADW_RUNNER_LINUX_NATIVE}/bin"; \
  fi

USER adw
WORKDIR /workspace
CMD ["sleep", "infinity"]
