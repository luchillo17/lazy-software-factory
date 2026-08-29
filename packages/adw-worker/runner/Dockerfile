# ADW runner image — generic Node environment (not Nx).
# Worker JS is pre-bundled on the host from the Factory lockfile (build-image.sh).
# Base: exact Node 24 LTS patch + OCI digest (image-pins.env).

ARG NODE_IMAGE=node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e

FROM ${NODE_IMAGE} AS runtime
ARG TARGETARCH
ARG DEBIAN_SNAPSHOT=20260824T000000Z
ARG CA_CERTIFICATES_VERSION=20250419~deb12u1
ARG CURL_VERSION=7.88.1-10+deb12u15
ARG GIT_VERSION=1:2.39.5-0+deb12u3
ARG GH_VERSION=2.98.0
ARG GH_AMD64_SHA256=f65a3fa2fa0eb2e97c445ee3f5e087a40aae03b64847f45a8f13805e504535d6
ARG GH_ARM64_SHA256=bbc4ac7964c2a091fd555cd1758d10a7cfcfdc472e405f0b0fb958f05d535cb6

RUN printf '%s\n' \
    'Types: deb' \
    "URIs: http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}" \
    'Suites: bookworm bookworm-updates' \
    'Components: main' \
    'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
    'Check-Valid-Until: no' \
    '' \
    'Types: deb' \
    "URIs: http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}" \
    'Suites: bookworm-security' \
    'Components: main' \
    'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
    'Check-Valid-Until: no' \
    > /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    "ca-certificates=${CA_CERTIFICATES_VERSION}" \
    "curl=${CURL_VERSION}" \
    "git=${GIT_VERSION}" \
  && case "${TARGETARCH}" in \
    amd64) GH_SHA256="${GH_AMD64_SHA256}" ;; \
    arm64) GH_SHA256="${GH_ARM64_SHA256}" ;; \
    *) echo "unsupported runner architecture: ${TARGETARCH}" >&2; exit 1 ;; \
  esac \
  && curl -fsSL \
    "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${TARGETARCH}.deb" \
    -o /tmp/gh.deb \
  && echo "${GH_SHA256}  /tmp/gh.deb" | sha256sum --check --strict \
  && apt-get install -y --no-install-recommends /tmp/gh.deb \
  && rm -f /tmp/gh.deb \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && groupadd --gid 10001 adw \
  && useradd --uid 10001 --gid adw --create-home --home-dir /home/adw adw \
  && mkdir -p /opt/factory/node_modules /workspace /home/adw/.cache \
  && chown -R adw:adw /opt/factory /workspace /home/adw

# Compiled worker + Review skill pack only (no Nx, tsx, TypeScript sources, or devDeps).
COPY packages/adw-worker/runner/dist/adw-worker.mjs /opt/factory/adw-worker.mjs
COPY packages/adw/host-skill-pack /opt/factory/host-skill-pack
# Cursor SDK production closure + linux native (real dirs; see stage-cursor-sdk-deps.mjs).
COPY packages/adw-worker/runner/dist/cursor-mods/ /opt/factory/node_modules/

ARG ADW_RUNNER_REQUIRE_CURSOR=0
ARG ADW_RUNNER_LINUX_NATIVE=sdk-linux-x64

ENV HOME=/home/adw \
  ADW_HOST_SKILL_PACK_ROOT=/opt/factory/host-skill-pack \
  NODE_PATH=/opt/factory/node_modules \
  npm_config_cache=/workspace/.npm-cache \
  npm_config_store_dir=/home/adw/.cache/pnpm-store \
  XDG_CACHE_HOME=/home/adw/.cache \
  NX_NATIVE_FILE_CACHE_DIRECTORY=/workspace/.nx/native-cache \
  NODE_ENV=production

# Fail the build if Cursor helpers are required but missing/unloadable (adjacent-only
# staging omitted transitive siblings like undici). Load connect-node so missing
# transitive deps fail at image build. Native packages have no "main" — assert on disk.
RUN chown -R adw:adw /opt/factory \
  && ! command -v nx >/dev/null \
  && ! command -v tsx >/dev/null \
  && if [ "${ADW_RUNNER_REQUIRE_CURSOR}" = "1" ]; then \
    node -e "require.resolve('@cursor/sdk'); require('@connectrpc/connect-node');" \
    && test -f "/opt/factory/node_modules/@cursor/${ADW_RUNNER_LINUX_NATIVE}/package.json" \
    && test -d "/opt/factory/node_modules/@cursor/${ADW_RUNNER_LINUX_NATIVE}/bin"; \
  fi

USER adw
WORKDIR /workspace
CMD ["sleep", "infinity"]
