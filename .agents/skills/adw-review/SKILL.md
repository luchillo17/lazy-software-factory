---
name: adw-review
description: "Minimal ADW Review — pending-delta findings, tool verdict (pass/fail), PR draft on pass."
disable-model-invocation: true
---

# ADW Review

Produce a **verdict** on the ticket branch for the ADW: **findings**, then submit via **Review verdict tools**. Orchestration routes on the tool stash only (ADR-0014) — **not** final-message JSON. The **Ship agent** commits, pushes, and opens the PR; do **not** forge yourself.

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

## 3. Verdict (tool wire)

Call **exactly one** submit tool to end the review. Assistant prose may stream for humans; it is **not** the routing wire. Do **not** emit `ReviewOutput` JSON as the final message.

If the tool returns an error, fix the arguments and call again in this **same** session (in-run repair — not a Build handoff).

### Pass

Empty **findings** (or empty pending). Write the **PR draft** first — see [pr-draft.md](pr-draft.md) — then call:

`submit_review_pass` with `{ prTitle, prBody }` — both non-empty strings from the PR draft.

**Done when:** **PR draft** meets [pr-draft.md](pr-draft.md), and `submit_review_pass` is accepted.

### Fail

Non-empty **findings**. Call:

`submit_review_fail` with `{ failReport }` — non-empty string listing every **finding** from step 2 (`path:line`, severity, problem, fix hint).

**Done when:** `submit_review_fail` is accepted with a complete `failReport`.
