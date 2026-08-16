# Host Minimal self-build (v0)

Manual path: one GitHub Issue labelled `ready-for-agent` through **Host** **Minimal ADW** to live **`shipped`** (PR URL on this repo).

Glossary: [`CONTEXT.md`](../CONTEXT.md). Cut: [`VISION.md`](./VISION.md) §3. Spine: [ADR-0007](./adr/0007-minimal-adw-build-test-review.md). Credentials: [ADR-0003](./adr/0003-runtime-credentials-per-run.md). Self-building: [ADR-0006](./adr/0006-factory-is-self-building.md).

This runbook uses **TicketIntake** (GitHub Issue ref). **Role skill binding** is already in Host (`/implement` on Build, `/adw-review` on Review) — do not re-paste skill lists into the Issue.

## Prerequisites

- Node `>=22.18` and pnpm (see root `package.json` `engines` / `packageManager`)
- Install at repo root: `pnpm install`
- Copy [`.env.example`](../.env.example) to gitignored `.env` and fill **`CURSOR_API_KEY`** + **`GH_TOKEN`** (Issues, Contents, Pull requests — comments on the example)
- `gh` on `PATH` (TicketIntake and Ship call it; `GH_TOKEN` is the forge credential)
- An **open** Issue on this repo with label **`ready-for-agent`**
- Run from the clone that should be the **Host sandbox** cwd (provision checks out `adw/<ticketId>` **in this tree**)
- No other Host ADW running (one sandbox at a time)

Flags and extra env (`ADW_MODEL`, `ADW_REPO_URL`, …): `pnpm adw:host -- --help` and `.env.example`. Prefer CLI `--issue`; do not set both `--issue` and `--ticket`/`--prompt`.

## Run

From the repo root:

```bash
pnpm adw:host -- --issue <n|#N|Issues-URL>
```

TicketIntake maps Issue number → `ticketId` and title+body → Build/Review work prompt. Progress lines look like `adw kind=step_enter step=provision` through `build`, `seam_confirm`, `test`, `review`, `ship`.

**SeamConfirm** is a Code agent (not an LLM): if Build stops with an empty pending delta and seam-wait text, Host confirms `/tdd` seams once and resumes Build (no Build-attempt spend). Otherwise it skips to Test.

## Done

The operator line must include **`status=shipped`** and **`pr=<https URL>`** for this repository. Process exit **0**.

`status=ready_for_pr` (exit 2) means Review passed but commit, push, or open-PR did not — not this runbook’s success. Merge/Engineer Review stays HITL after Ship (ADR-0011).

## Host gotchas

- **Branch yank.** Provision runs `git checkout -B adw/<ticketId>` on the current clone. Uncommitted work on another branch is not protected. Start from a clean `main` (or a base you intend to reset).
- **Forge identity.** `GH_TOKEN` must belong to an account that can push and open PRs on this repo. Browser merge uses whatever GitHub session is logged in — a different account will hide merge actions even when Ship succeeded.
- **Skill pack.** Build needs `.agents/skills` on cwd (`/implement` closure). Review’s `/adw-review` comes from the Host-bundled pack (`packages/adw/host-skill-pack`); the target tree need not vendor it.

## Proven live

On 16 Aug 2026, Issue [#42](https://github.com/luchillo17/lazy-software-factory/issues/42) (`ready-for-agent`) ran as:

```bash
pnpm adw:host -- --issue 42
```

from this repo root (TicketIntake + Role skill bindings). Result: `status=shipped` and PR [#63](https://github.com/luchillo17/lazy-software-factory/pull/63) (`feat(runtime): pass Cursor SDK agents on create/resume`), later merged to `main`.
