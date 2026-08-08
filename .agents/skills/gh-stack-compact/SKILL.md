---
name: gh-stack-compact
description: >
  Manage stacked PRs with `gh stack` (compact skill). Use when growing a stack,
  linking a PR into a stack, editing a mid-layer, merging a stack, or
  syncing/rebasing after a mid-layer change. Prefer over the official bloated
  gh-stack skill when you want gotchas only.
---

# gh-stack-compact

`gh stack` — ordered **layers** (branch + PR) rooted on trunk. Bottom nearest trunk; top furthest. `up` / `down` = away from / toward trunk.

```
trunk
 └── layer-a  → PR (base: trunk)     ← bottom
  └── layer-b → PR (base: layer-a)   ← top
```

Command flags: `gh stack <cmd> --help` (environment is source of truth — do not restate help here).

## Non-interactive

Prompts hang agents. On every call:

1. Pass branch names to `init` / `add` / `checkout` (no bare invocations).
2. `gh stack view --json`
3. `gh stack submit --auto`
4. `gh stack merge --yes` (not `gh pr merge` for the stack)

Multi-remote: `git config remote.pushDefault origin` (`checkout` / `init` / `add` have no `--remote`). Pass `--remote origin` on commands that accept it.

`init` may ask about rerere → `git config rerere.enabled true` once, then retry.

## Membership

**Membership** = the stack object lists the PR (`gh stack view --json`). A correct PR `baseRefName` alone is not membership. Attach with `submit` or `link`.

## Steps

### 1. Orient

```bash
gh stack view --json
```

**Done when:** stack # (if any), trunk, and whether the target already has membership are known.

Non-zero and next move unclear → read [exits.md](exits.md) (keep stderr; `--json` data is on stdout).

### 2. Change the stack

Take one path. **Done when:** the intended tip has membership (re-check `view --json` or `link` stderr).

**Grow** (local tracking):

```bash
gh stack init --base <trunk> <branch>   # or on tip: gh stack add <branch>
# commit…
gh stack submit --auto --open
```

**Link** (PR already open, or lower layers locked in other worktrees) — additive; no local tracking:

```bash
gh stack link <stack#> <pr-or-branch>
# or: gh stack link --base <trunk> <bottom> … <top>
```

First numeric arg is a stack # only if that stack exists; otherwise PR/branch.

**Mid-layer:**

```bash
gh stack checkout <layer>
# commit…
gh stack rebase --upstack
gh stack push
```

Tracking diverge (common with worktrees): `gh stack unstack --local`, then `gh stack checkout <stack-or-pr#>`.

**Merge:** `gh stack merge --yes`
