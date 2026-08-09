## Agent skills

### Issue tracker

GitHub Issues via `gh` (`luchillo17/lazy-software-factory`). See `docs/agents/issue-tracker.md`.

### Triage labels

Defaults: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Skills install (Claude + Cursor)

Canonical skills live in `.agents/skills/`. Claude Code uses `.claude/skills/` as **symlinks** to that tree — not copies. When adding or re-linking project skills, run `npx skills add <owner/repo> --agent claude-code cursor -y` (never Claude alone: the CLI copies). Full recipe and verify steps: `docs/agents/skills-install.md`.

### Effect (vendored reference)

**Default:** Effect **4 beta** (exact `4.0.0-beta.x` pins) for `packages/*` and `apps/*` unless a real constraint blocks it; root `scripts/` may stay plain Node (ADR-0008). Prefer `effect/*` over `effect/unstable/*`. When writing or reviewing Effect code, read `repos/effect/` (and `repos/effect/LLMS.md` if present) for idiomatic usage, tests, module layout, and API design (ADR-0012). Treat `repos/` as read-only reference — do not edit or import from it; app code imports `effect` from npm. After studying the tree, you may add short notes under `docs/agents/effect-patterns/`.
