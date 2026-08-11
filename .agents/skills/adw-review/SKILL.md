---
name: adw-review
description: "Minimal ADW Review step — ticket-branch findings + structured pass/fail verdict."
disable-model-invocation: true
---

# ADW Review

Produce a **verdict** on the current ticket branch: **findings** (location + severity), then machine-readable JSON for the ADW.

## 1. Diff

Capture the three-dot diff from the merge-base with trunk (`origin/main` or `main`) to `HEAD`:

```bash
git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main
git diff <merge-base>...HEAD
```

**Done when:** the diff text is in hand. Empty diff → step 3 with `verdict: pass`.

## 2. Findings

Inspect the diff (open files only as needed). List every likely bug, regression, broken edge case, or security mistake the change introduces.

Each **finding** has: `path:line` (or range), severity (`high` / `medium` / `low`), problem, fix hint for Build.

**Done when:** every such issue in the diff is listed, or the list is empty.

## 3. Verdict

Emit exactly one JSON object as the **last** block:

```json
{ "verdict": "pass" }
```

or

```json
{
  "verdict": "fail",
  "failReport": "<all findings: location, severity, problem, fix hint>"
}
```

**Done when:** `verdict` is `pass` (empty findings / empty diff) or `fail` with a non-empty `failReport`.
