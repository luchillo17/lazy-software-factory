# Git host package + Ship agent statuses

Clone, **commit pending worktree**, push, and pull/merge requests go through a pluggable **Git host** seam in its own package (`packages/git-host` or equivalent) — not through Runtime agent/sandbox adapters and not via scattered `gh` calls inside ADW control flow. **GitHub via `gh` + `GH_TOKEN` is the first adapter**, not the only forge forever (GitLab/Bitbucket/etc. later behind the same interface).

After Agent Review **pass** (including schema-required **`prTitle` + `prBody`**), orchestration builds **`ShipInput`** and runs the **Ship agent** (a **Code agent**, same class as Test agent): **commit working tree if dirty**, then **push** the ticket branch, then open a PR/MR with those title/body fields. Build **may** commit mid-run; Ship still flushes any remaining pending so nothing ships uncommitted. Test/Review do not push. Results:

- **`shipped`** — PR/MR exists (URL recorded)
- **`ready_for_pr`** — Review passed but commit, push, or PR open skipped/failed (missing CLI/auth/remote, provider error)

Do not spend Build or Review attempts retrying Ship. `shipped` means PR opened, not merged or deployed. Merge-conflict rebase is out of v0 Ship. Do not draw a Merge/deploy node after Ship in ADW diagrams — Engineer Review / humans own merge.

Flow diagram (Prompt → … → Engineer Review): see [ADR-0007](./0007-minimal-adw-build-test-review.md).

## Status

accepted

## Considered Options

- **GitHub-only forever / raw `gh` inside ADW or Runtime** — rejected; forge will diversify; keep adapter at the package boundary.
- **Build or Review LLM pushes and opens the PR** — rejected; Ship must stay a Code agent (deterministic, credential-scoped).
- **Separate Ship LLM draft agent** — rejected for v0; Review pass already authors `prTitle`/`prBody` into `ShipInput`.
- **Build is the only committer; Ship only pushes** — rejected; dogfood left Review→Build resume files uncommitted after `shipped`.
- **`shipped` even when no PR (best-effort Ship)** — rejected; ops need a clear `ready_for_pr` vs `shipped` signal.
- **Fail the whole ADW when Ship cannot open a PR** — rejected; agent loop succeeded; missing forge setup should not rewind Build/Review.
