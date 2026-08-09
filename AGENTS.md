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

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure
- **New** `packages/*` / `apps/*`: create with `pnpm nx g @nx/js:library` (or the matching app generator) — do not hand-scaffold
- Vendored `repos/` is ignored by Nx (`.nxignore`); not a workspace project

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
