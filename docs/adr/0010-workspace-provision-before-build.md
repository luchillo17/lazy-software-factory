# Workspace provision before Build

Every minimal ADW run starts with deterministic **workspace provision** inside the warm sandbox **before** any LLM Build step. Provision: ensure a git worktree, create/checkout an orchestration-owned ticket branch (e.g. `adw/<ticketId>`), then run a **locked install** for generic Node repositories when a supported package manager and lockfile are present. Provision failure → ADW `failed` with no agent burn.

**Package manager resolution (default Node runner):** prefer the target repo’s `package.json` `packageManager` field (Corepack activates the declared pnpm/Yarn version when present); otherwise fall back to a single recognized lockfile (`pnpm-lock.yaml`, `yarn.lock`, `package-lock.json` / `npm-shrinkwrap.json`). Installs are immutable/frozen (`npm ci`, `pnpm install --frozen-lockfile`, Yarn `--immutable` or Classic `--frozen-lockfile`). Missing, contradictory, or unsupported managers (including Bun and non-Node toolchains) fail WorkspaceProvision before Build. The runner does **not** require Nx. Install commands run via sandbox `exec` in the worker-local workspace (same path Host and later Docker share).

**Host sandbox:** reuse an already-cloned path when `.git` is present (skip clone; still branch + install as needed). **Cloud / empty box:** clone via the Git host using per-run credentials (ADR-0003), then branch + install. Same ADW graph for Host and cloud — only the ensure-repo step differs. Host remains single-ADW-at-a-time; isolation stays weaker than Docker (ADR-0008).

## Status

accepted

## Considered Options

- **Build agent owns clone/branch/install** — rejected; nondeterministic setup burns tokens and strands runs on the wrong branch.
- **Assume every sandbox already has the repo** — rejected; breaks cloud/empty boxes and hides Host vs cloud differences.
- **Always clone even on Host** — deferred; cleaner but slower; Host reuse of an existing clone is the v0 default.
- **Custom bootstrap script required in v0** — rejected; locked install from declared manager + lockfile is enough; bootstrap escape hatch later.
- **Assume this Factory’s pnpm/Nx workspace only** — rejected; the default runner must provision arbitrary npm/pnpm/Yarn Node repos (Bun and non-Node need alternate images).
