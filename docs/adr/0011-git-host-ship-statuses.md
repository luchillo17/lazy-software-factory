# Git host package + Ship statuses

Clone, push, and pull/merge requests go through a pluggable **Git host** seam in its own package (`packages/git-host` or equivalent) — not through Runtime agent/sandbox adapters and not via scattered `gh` calls inside ADW control flow. **GitHub via `gh` + `GH_TOKEN` is the first adapter**, not the only forge forever (GitLab/Bitbucket/etc. later behind the same interface).

After Review **pass**, the **Ship** step (orchestration + Git host): **push** the ticket branch from the warm sandbox, then open a PR/MR. Build only commits locally; Test/Review do not push. Results:

- **`shipped`** — PR/MR exists (URL recorded)
- **`ready_for_pr`** — Review passed but push or PR open skipped/failed (missing CLI/auth/remote, provider error)

Do not spend Build or Review attempts retrying Ship. `shipped` means PR opened, not merged.

## Status

accepted

## Considered Options

- **GitHub-only forever / raw `gh` inside ADW or Runtime** — rejected; forge will diversify; keep adapter at the package boundary.
- **Build agent pushes and opens the PR** — rejected; Ship must stay deterministic and credential-scoped.
- **`shipped` even when no PR (best-effort Ship)** — rejected; ops need a clear `ready_for_pr` vs `shipped` signal.
- **Fail the whole ADW when Ship cannot open a PR** — rejected; agent loop succeeded; missing forge setup should not rewind Build/Review.
