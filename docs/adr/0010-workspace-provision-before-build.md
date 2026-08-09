# Workspace provision before Build

Every minimal ADW run starts with deterministic **workspace provision** inside the warm sandbox **before** any LLM Build step. Provision: ensure a git worktree, create/checkout an orchestration-owned ticket branch (e.g. `adw/<ticketId>`), then run a **locked install** when a lockfile exists (e.g. `pnpm install`). Provision failure → ADW `failed` with no agent burn.

**Host sandbox:** reuse an already-cloned path when `.git` is present (skip clone; still branch + install as needed). **Cloud / empty box:** clone via the Git host using per-run credentials (ADR-0003), then branch + install. Same ADW graph for Host and cloud — only the ensure-repo step differs. Host remains single-ADW-at-a-time; isolation stays weaker than Docker (ADR-0008).

## Status

accepted

## Considered Options

- **Build agent owns clone/branch/install** — rejected; nondeterministic setup burns tokens and strands runs on the wrong branch.
- **Assume every sandbox already has the repo** — rejected; breaks cloud/empty boxes and hides Host vs cloud differences.
- **Always clone even on Host** — deferred; cleaner but slower; Host reuse of an existing clone is the v0 default.
- **Custom bootstrap script required in v0** — rejected; locked install from lockfile is enough for this monorepo; bootstrap escape hatch later.
