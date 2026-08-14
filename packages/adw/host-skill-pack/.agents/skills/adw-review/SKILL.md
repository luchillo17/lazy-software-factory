---
name: adw-review
description: "Minimal ADW Review — pending delta, findings, tool-wire verdict (Ship opens the PR)."
disable-model-invocation: true
---

# ADW Review

Judge the ticket branch's **pending delta**. End with one accepted **verdict** tool call. Ship commits, pushes, and opens the PR from a pass.

## 1. Pending delta

Collect committed tip **and** dirty worktree:

```bash
git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main
git diff <merge-base>...HEAD
git diff
git diff --cached
git status --porcelain
```

Open untracked paths from status as needed. Empty committed diff **and** empty worktree → step 3 pass (with **PR draft**).

**Done when:** three-dot tip plus unstaged, staged, and untracked pending are in hand.

## 2. Findings

From that **pending delta**, and against the **Ticket** section in the session prompt (acceptance criteria / issue body), list every likely bug, regression, broken edge case, missing AC, or security mistake the change introduces (including uncommitted files).

Each **finding**: `path:line` (or range), severity (`high` / `medium` / `low`), problem, fix hint for Build.

**Done when:** every such issue is listed, or the list is empty.

## 3. Verdict

Call exactly one submit tool. Prose may stream for humans; the accepted tool call is the wire. On tool error, fix args and call again in this session.

### Pass

Empty **findings** (or empty pending). Write the **PR draft** per [pr-draft.md](pr-draft.md), then call `submit_review_pass` with `{ prTitle, prBody }` from that draft (both non-empty).

**Done when:** draft meets [pr-draft.md](pr-draft.md) and `submit_review_pass` is accepted.

### Fail

Non-empty **findings**. Call `submit_review_fail` with `{ failReport }` covering every **finding** from step 2 (`path:line`, severity, problem, fix hint).

**Done when:** `submit_review_fail` is accepted with that complete `failReport`.
