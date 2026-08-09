## Agent skills

### Issue tracker

GitHub Issues via `gh` (`luchillo17/lazy-software-factory`). See `docs/agents/issue-tracker.md`.

### Triage labels

Defaults: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Effect (vendored reference)

**Default:** Effect for `packages/*` and `apps/*` unless a real constraint blocks it; root `scripts/` may stay plain Node (ADR-0008). When writing or reviewing Effect code, inspect `repos/effect/` for idiomatic usage, tests, module structure, and API design (ADR-0012). Prefer that source over web search or guesses. Read `repos/effect/LLMS.md` before writing Effect code when present. Treat `repos/` as read-only reference — do not edit it or import from it; app code imports `effect` from npm. Optional: add concise notes under `docs/agents/effect-patterns/` after studying the vendored tree.

### Related skills

`gh-stack-compact` lives in [`luchillo17/gh-stack-compact`](https://github.com/luchillo17/gh-stack-compact) — install with `npx skills add luchillo17/gh-stack-compact`. Compact skill (membership, non-interactive, recipes); distinct from the official `gh-stack` skill id; not part of this monorepo.
