---
name: adw-review
description: "Minimal ADW Review — pending-delta findings, structured verdict, PR draft on pass."
disable-model-invocation: true
---

# ADW Review

Produce a **verdict** on the ticket branch for the ADW: **findings**, then one JSON object. Review emits that JSON only — the **Ship agent** commits, pushes, and opens the PR.

## 1. Pending delta

Gather the **full pending delta** — committed tip **and** dirty worktree:

```bash
git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main
git diff <merge-base>...HEAD
git diff
git diff --cached
git status --porcelain
```

Open untracked paths from `git status --porcelain` as needed. Empty committed diff **and** empty worktree → step 3 **pass** (with **PR draft**).

**Done when:** three-dot committed diff plus unstaged/staged/untracked pending are in hand.

## 2. Findings

Inspect that **pending delta** (open files only as needed). List every likely bug, regression, broken edge case, or security mistake the change introduces — including issues only in uncommitted files.

Each **finding**: `path:line` (or range), severity (`high` / `medium` / `low`), problem, fix hint for Build.

**Done when:** every such issue in the pending delta is listed, or the list is empty.

## 3. Verdict

Emit exactly one JSON object as the **last** block.

### Pass

Empty **findings** (or empty pending). Write the **PR draft** first — see [pr-draft.md](pr-draft.md) — then emit:

```json
{
  "verdict": "pass",
  "prTitle": "<from PR draft>",
  "prBody": "<from PR draft>"
}
```

**Done when:** **PR draft** meets [pr-draft.md](pr-draft.md), and JSON includes non-empty `prTitle` + `prBody`.

### Fail

Non-empty **findings**. Emit **verdict** + `failReport` only:

```json
{
  "verdict": "fail",
  "failReport": "<all findings: location, severity, problem, fix hint>"
}
```

**Done when:** `failReport` lists every **finding** from step 2.
