# Host Minimal self-build (v0)

Manual path: one GitHub Issue labelled `ready-for-agent` through **Host** **Minimal ADW** to live **`shipped`** (PR URL on this repo).

Glossary: [`CONTEXT.md`](../CONTEXT.md). Cut: [`VISION.md`](./VISION.md) §3 (self-build) · §4 (foreign cwd). Spine: [ADR-0007](./adr/0007-minimal-adw-build-test-review.md). Credentials: [ADR-0003](./adr/0003-runtime-credentials-per-run.md). Self-building: [ADR-0006](./adr/0006-factory-is-self-building.md). Provision reuse: [ADR-0010](./adr/0010-workspace-provision-before-build.md). Sequencing vs Docker: [ADR-0015](./adr/0015-host-foreign-cwd-before-docker.md).

This runbook uses **TicketIntake** (GitHub Issue ref). **Role skill binding** is already in Host (`/implement` on Build, `/adw-review` on Review) — do not re-paste skill lists into the Issue.

## Prerequisites

- Node `>=22.18` and a supported package manager for the **target** tree (npm, pnpm, or Yarn — see that repo’s `packageManager` / lockfile; Factory self-build uses pnpm per root `package.json`)
- Install at the **Factory** repo root: `pnpm install` (needed even when the sandbox is a sibling tree — Host loads packages from this checkout). WorkspaceProvision then runs the target’s own locked install inside the sandbox cwd (not an Nx requirement on the target).
- Copy [`.env.example`](../.env.example) to gitignored `.env` on the **sandbox cwd** (Factory clone for self-build; target tree for foreign cwd) and fill **`CURSOR_API_KEY`** + **`GH_TOKEN`** (Issues, Contents, Pull requests — comments on the example). Shell env already set wins over dotenv.
- `gh` on `PATH` (TicketIntake and Ship call it; `GH_TOKEN` is the forge credential)
- An **open** Issue on the **target** repo with label **`ready-for-agent`**
- No other Host ADW running (one sandbox at a time)

Flags and extra env (`ADW_MODEL`, `ADW_REPO_URL`, `ADW_CWD`, …): `pnpm adw:host -- --help`, `adw-host --help`, and `.env.example`. Prefer CLI `--issue`; do not set both `--issue` and `--ticket`/`--prompt`.

## Run (Factory self-build)

From this repo root (sandbox = process cwd; omit `--cwd`):

```bash
pnpm adw:host -- --issue <n|#N|Issues-URL>
```

TicketIntake maps Issue number → `ticketId` and title+body → Build/Review work prompt. Progress lines look like `adw kind=step_enter step=provision` through `build`, `seam_confirm`, `test`, `review`, `ship`.

**SeamConfirm** is a Code agent (not an LLM): if Build stops with an empty pending delta and seam-wait text, Host confirms `/tdd` seams once and resumes Build (no Build-attempt spend). Otherwise it skips to Test.

## Run (foreign git tree)

Aim Host at another checkout **without** treating `--repo-url` as a tree switch (see footgun below).

**From the target repo** (bin injects invoker cwd when `--cwd` is omitted). Root `package.json` maps `adw-host` → `./bin/adw-host.mjs`:

```bash
/path/to/lazy-software-factory/bin/adw-host.mjs --issue <n|#N|Issues-URL>
```

**From the Factory clone**, name the tree:

```bash
pnpm adw:host -- --issue <n|#N|Issues-URL> --cwd /path/to/sibling-repo
# or relative to the invoker directory:
pnpm adw:host -- --issue <n|#N|Issues-URL> --cwd ../sibling-repo
```

`ADW_CWD` is the env fallback for `--cwd`. Sandbox create, TicketIntake `gh` (bare Issue numbers), and `<cwd>/.env` all follow that Host cwd. Issue URLs with owner/repo still use `-R` as today.

Synthetic work (no GitHub Issue): `--ticket <id> --prompt <text>` with the same `--cwd` / `adw-host` rules.

Long runs: a **human tty** should **detach** (`setsid` / `systemd-run --user`). Cursor **agent Shell** is the opposite — see Host gotchas. An aborted wrapper is not an ADW `failed` status.

## Done

The operator line must include **`status=shipped`** and **`pr=<https URL>`** for the **target** repository. Process exit **0**.

`status=ready_for_pr` (exit 2) means Review passed but commit, push, or open-PR did not — not this runbook’s success. Merge/Engineer Review stays HITL after Ship (ADR-0011).

## Host gotchas

- **`--repo-url` does not switch trees.** If the sandbox cwd already has `.git`, Workspace provision **reuses** that worktree (ADR-0010). Passing `--repo-url` from a Factory checkout does **not** aim Host at another product — use `--cwd` or run `adw-host` from that product.
- **Branch yank.** Provision runs `git checkout -B adw/<ticketId>` **in the sandbox cwd**. Uncommitted work on another branch in that tree is not protected. Start from a clean `main` (or a base you intend to reset). Aiming `--cwd` at a sibling leaves the Factory clone alone; aiming at the Factory clone still yanks it.
- **Forge identity.** `GH_TOKEN` must belong to an account that can push and open PRs on the **target** repo. Browser merge uses whatever GitHub session is logged in — a different account will hide merge actions even when Ship succeeded.
- **Skill pack.** Build needs `.agents/skills` on the sandbox cwd (`/implement` closure). Review’s `/adw-review` comes from the Host-bundled pack (`packages/adw/host-skill-pack`); the target tree need not vendor it.
- **Cursor agent Shell vs detach.** `adw-host` is fine; the wrapper’s lifetime is not. When the agent Shell **returns**, Cursor kills that **process group**. `nohup … &` then `head` the log dies after provision/build enter. Keep the Shell job **open** (`block_until_ms: 0` / foreground `adw-host`). Real detach from the agent needs a **new session** (`setsid` / `systemd-run --user`), not `nohup` in the same group. A human tty can `nohup`/`setsid` as usual.

## Proven live

On 16 Aug 2026, Issue [#42](https://github.com/luchillo17/lazy-software-factory/issues/42) (`ready-for-agent`) ran as:

```bash
pnpm adw:host -- --issue 42
```

from this repo root (TicketIntake + Role skill bindings). Result: `status=shipped` and PR [#63](https://github.com/luchillo17/lazy-software-factory/pull/63) (`feat(runtime): pass Cursor SDK agents on create/resume`), later merged to `main`.

## Docker (explicit; not yet default)

Isolated Minimal ADW via classic Docker (issue #84). Build the local runner image, then:

```bash
pnpm adw:runner:build
pnpm adw -- --sandbox docker --issue <n> --repo-url <git-url> [--starting-ref <ref>]
```

Docker rejects `--cwd` (no dirty-tree bind mounts). Default `--sandbox` remains `host` until the live proof (#86). Real-daemon integration: `pnpm nx run @lazy-software-factory/adw:test-docker` (not cached; fails if Docker is unavailable) — builds the runner image once, runs concurrent Minimal ADWs, isolation + cancel leak checks (#85). Provider contract map (incl. future Vercel semantics): `docs/agents/sandbox-provider-conformance.md`.
