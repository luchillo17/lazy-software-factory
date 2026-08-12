---
name: adw-review
description: "Minimal ADW Review step — ticket-branch findings + structured pass/fail verdict."
disable-model-invocation: true
---

# ADW Review

Produce a **verdict** on the current ticket branch: **findings** (location + severity), then machine-readable JSON for the ADW. Do **not** `git commit`, stage, push, or open a PR — Ship agent owns that.

## 1. Diff

Capture the **full pending delta** — committed tip **and** dirty worktree:

```bash
git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main
git diff <merge-base>...HEAD
git diff
git diff --cached
git status --porcelain
```

Include untracked files from `git status --porcelain` (open them as needed). Empty committed diff **and** empty worktree pending → step 3 with `verdict: pass` and a short PR draft.

**Done when:** committed three-dot diff plus unstaged/staged/untracked pending are in hand.

## 2. Findings

Inspect that full pending delta (open files only as needed). List every likely bug, regression, broken edge case, or security mistake the change introduces — including issues only in uncommitted files.

Each **finding** has: `path:line` (or range), severity (`high` / `medium` / `low`), problem, fix hint for Build.

**Done when:** every such issue in the pending delta is listed, or the list is empty.

## 3. Verdict

Emit exactly one JSON object as the **last** block.

**Pass** (empty findings / empty pending) — include PR draft for the Ship agent:

```json
{
  "verdict": "pass",
  "prTitle": "<concise conventional title>",
  "prBody": "<markdown: summary + test plan>"
}
```

**Fail** — do not invent PR fields:

```json
{
  "verdict": "fail",
  "failReport": "<all findings: location, severity, problem, fix hint>"
}
```

**Done when:** `verdict` is `pass` with non-empty `prTitle` + `prBody`, or `fail` with a non-empty `failReport`.
