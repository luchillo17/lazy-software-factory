# lazy-software-factory

Open-source software factory: orchestrated AI developer workflows with hard gates, usable locally, on-prem, or as extractable packages — with a later path to hosted multi-organization use. The factory is self-building: it develops this repo through its own ADWs.

## Language

**Factory**:
The product that orchestrates AI developer workflows end-to-end (intake → agent work → gates → merge/PR), not a single agent chat session.
_Avoid_: Platform (unless meaning the hosted multi-org product specifically), pipeline (too CI-generic)

**Self-building**:
Using this Factory’s ADWs to develop this repo’s apps and packages (apply the factory inward).
_Avoid_: Self-hosting (means on-prem/local deploy here), dogfooding (optional prose only)

**ADW**:
An AI developer workflow — a composable coded graph of agent steps, deterministic gates, and/or nested ADWs for a unit of work (see `packages/adw`). Leaf ADWs wire agents + gates; composite ADWs chain Agents and/or nested ADWs (e.g. **Feature ADW** = Planner Agent + **Minimal ADW**). Do not wrap a single Agent as its own ADW.
_Avoid_: Pipeline, agent loop (a single agent chat iteration is not the whole ADW); treating ADWs as non-nestable flat scripts only; one-node ADW wrappers around a single Agent

**Minimal ADW**:
The leaf ADW: **Build agent** ↔ **Test agent** (Code agent) → **Review agent** → **Ship agent** (Code agent) (ADR-0007 shape). Own Build/Review attempt caps and warm-sandbox loop.
_Avoid_: Calling this Feature; dropping Review from Minimal

**Code agent**:
A deterministic, composable ADW graph node — **not** an LLM. Schema-guaranteed inputs (and coded outputs/statuses). Examples: **Test agent**, **Ship agent**. Distinct from configured LLM **Agent** (Build, Review, Planner).
_Avoid_: Calling Code agents “LLM agents”; giving Ship forge credentials to an LLM session; free-text-only inputs to Code agents

**Feature ADW**:
A composite ADW: **Planner Agent** then nested **Minimal ADW**. Shares one warm sandbox with the child. Ship agent stays on Minimal after Review pass. Planner binds `/codebase-design` + `/domain-modeling` and emits a **`/to-plan`** artifact (plan.md-like + handoff discipline) for Minimal. Provisional nested routing: Agent Review-fail stays local inside Minimal; Minimal exhaustion bubbles to Planner for **plan-only** re-entry (not code edits) — see `docs/VISION.md`.
_Avoid_: Planner-as-ADW when it is only one Agent; renaming Minimal to Feature; treating Agent Review-fail like HITL Engineer Review→Planner; Planner editing code on replan; treating suggested skills in a plan as overriding the Agent’s Role skill binding

**Agent** (configured):
A reusable **LLM** role primitive with its **Skill pack** and **Role skill binding** (e.g. Build, Review, Planner). ADWs compose LLM Agents, **Code agents**, and nested ADWs; Agents do not embed ADW routing. Distinct from **Agent session** (one running thread) and from **Code agent**.
_Avoid_: Letting each ADW re-own skill policy; equating Agent with Agent session or with the whole ADW; wrapping one Agent in a throwaway ADW just for symmetry; calling Test/Ship LLM Agents

**Gate**:
A deterministic pass/fail check owned by orchestration (lint, typecheck, test, policy). Green advances the ADW; red routes back.
_Avoid_: Validation (too vague), agent self-check

**Build attempt**:
One Build agent run (create or resume) in the **Build↔Test** loop only. Own counter (v0 default cap **5**), **separate from Review attempts**. Test-fail → resume Build spends one Build attempt. Review-fail → resume Build does **not** spend a Build attempt — that path is charged only as a Review attempt when Review ran.
_Avoid_: One shared budget with Review; counting Review→Build resumes as Build attempts; counting Test agent execs as attempts; unbounded Test→Build resume

**Review attempt**:
One Review agent **create** when entering Review from the Build/Test path (new session). Own counter (v0 default cap **3**), **separate from Build attempts**. Wire-miss **resumes** of that session do **not** spend an extra Review attempt; they use an inner wire-miss resume cap (v0 default **3**) per Review session. Caps Review↔Build thrash; exhaust Review attempts or wire-miss resume cap → ADW `failed` even if Build attempts remain. After a valid Review fail, resuming Build with the fail report does not decrement the Build counter.
_Avoid_: Sharing one counter with Build↔Test; charging Review→Build or wire-miss resumes to the Build cap; charging every wire-miss resume as a new Review attempt; unlimited Review or wire-repair retries

**Build agent**:
The LLM agent session that implements the ticket in the warm sandbox. Its `AgentSession` is the durable resume target when the Test agent fails or Review fails. v0 orchestration does **not** consume structured Build output (Test agent gates); no Build submit tools required.
_Avoid_: Treating Review’s session as the place to keep coding; inventing Build structured wire with no orchestration consumer

**Test agent**:
A **Code agent** that runs **check-only** gates via the Runtime — not an LLM. Host resolves gates from the target repo root `package.json` scripts (`type-check`/`typecheck`, `lint:check`/`lint`, `test:run`/`test:ci`/`test`, …) as `pnpm|npm|yarn|bun run <script>` — not Factory-hardcoded nx package lists. Independent checks run **in parallel**; any red resumes Build with a **combined** fail report (all failing gates’ output), same session and sandbox. Pass all → Review. No matching scripts → ADW `failed` (no silent green).
_Avoid_: Test-writing agent, QA agent (unless we add a separate LLM role later); fail-fast on first red; mutating format/write steps inside the Test agent; reading Build LLM structured output to decide pass/fail; baking one monorepo’s nx project list into Host Test

**Review agent**:
The LLM agent that critiques the change after the Test agent passes — same _shape_ as a Bugbot-style review (findings with location/severity), but orchestration does **not** auto-fix. Entering Review from Build/Test always starts a **new** `AgentSession` in the same warm sandbox. Structured **Review verdict** is captured **tool-only** via Runtime `local.customTools` submit tools (ADR-0014); Effect Schema in `execute` is the hard check. On **wire miss** (no accepted tool payload at harvest), orchestration **resumes that Review session** until a valid **Review verdict** or the inner wire-miss resume cap. A valid **fail** verdict’s fail report is the feedback when resuming Build. A valid **pass** includes **`prTitle` + `prBody`** (PR draft for the Ship agent). Review judges the **full pending delta**: committed ticket-branch tip **plus** unstaged/untracked worktree edits — not `merge-base...HEAD` alone. Review does **not** commit, push, or open PRs (Ship agent owns forge). Assistant prose may stream for humans; it is not the routing wire.
_Avoid_: Same-session Review-as-Build; new Build session on every Review fail; treating wire-miss resume like content-fail→Build; Review that only chats with no machine-readable verdict; Review that applies fixes itself in the Minimal ADW; HEAD-only Review that ignores pending disk edits; Review that invents forge ops; parsing final-message JSON for the verdict once tools are the wire; Cursor `cloud` Agent.create for ADW Review

**Ship agent**:
A **Code agent** (same class as Test agent). After Review **pass**, orchestration decodes **`ShipInput`** (from pass `prTitle`/`prBody` + cwd/branch/ticket/env) and runs Ship: **commit working tree if dirty**, then **push**, then **open a pull/merge request** via the **Git host** using that schema input. Build **may** commit mid-run; Ship still flushes leftovers. Test/Review do not push. v0 result: **`shipped`** only when a PR/MR exists (URL recorded); **`ready_for_pr`** when Review passed but commit, push, or PR open skipped/failed. Do not burn Build/Review attempts retrying Ship. Merge-conflict rebase is out of v0 Ship. Post-`shipped` **Engineer Review** is HITL on the PR (outside Minimal ADW automation). **Ship ≠ merge/deploy/release** — name is “ship the change into a PR,” not production ship.
_Avoid_: Equating shipped with merged or deployed; drawing Merge→Ship as if Ship deploys; requiring Docker for Ship; failing the whole ADW solely because Ship could not open a PR; hard-coding GitHub as the only forge forever; making the Build or Review LLM responsible for push/PR; treating Ship as an LLM agent; Ship that only pushes HEAD and leaves dirty worktree behind; free-text Ship inputs without schema decode

**Git host**:
Pluggable forge for clone/commit-pending/push/PR-MR (GitHub via `gh` + `GH_TOKEN` first; later GitLab/Bitbucket/etc. behind the same seam). Lives in its own package seam (`packages/git-host` or equivalent): ADW decides _when_ to provision/Ship; the adapter decides _how_. Not part of Runtime (sandbox/agents) and not raw `gh` calls inside the ADW loop.
_Avoid_: Assuming GitHub-only; calling every forge “GitHub”; baking `gh` into Runtime or ADW control-flow code; putting clone/push inside `AgentProvider`

**Review verdict**:
Structured Review output (`ReviewOutput`) orchestration routes on: **pass** (with non-empty **`prTitle` + `prBody`**) or **fail** (with fail report for Build). Obtained via submit tools (ADR-0014); **PR draft** quality SoT is `/adw-review` (`pr-draft.md`) — title + lead paragraph alone name the concrete change. Missing accepted tool payload (including pass missing PR draft fields) is a **wire miss**: resume Review (not Build); only a **valid fail** resumes Build. Valid pass advances to Ship with those fields as `ShipInput`. Dismiss-with-reason is a human/later concern.
_Avoid_: Free-text-only Review; routing wire miss to Build; trusting Review to merge/ship; treating false-positive dismissal as v0 ADW logic; pass without PR draft fields; ticket-id-only or `ADW: …` titles; vague “updates” bodies; duplicating PR draft rules outside `/adw-review`; final-message JSON as the routing wire after tool cutover

**Wire miss**:
Structured Agent output not accepted at harvest when orchestration needs it for routing — typically no successful submit tool call, or harvest decode failure. Resume the **same** Agent session under the inner wire-miss resume cap; do not treat as content-fail to another Agent. In-session tool execute errors are not wire misses until the run ends without an accepted payload. Replaces “schema miss” as the umbrella term (progress kind renames with cutover).
_Avoid_: Schema miss as the preferred glossary term going forward; sending wire miss to Build; charging in-session tool `isError` to the wire-miss cap; parsing assistant prose to satisfy the wire

**Agent session**:
A resumable LLM thread owned by an `AgentProvider`, identified by an **opaque** `sessionId` the orchestration stores as a pointer. The Cursor adapter maps that id to whatever `@cursor/sdk` needs for create/resume; ADW types do not expose Cursor-specific field names. Build keeps one durable session per ticket; Review keeps one session per Review attempt (new on entry from Build/Test; resumable for wire-miss repair). ADW Agents use SDK **local** agents with Factory sandbox `cwd` — not Cursor hosted cloud agents.
_Avoid_: Equating session with sandbox; putting `cursorAgentId` (or similar) on ADW/domain types; treating session id format as domain knowledge; Cursor `cloud` Agent.create as the ADW agent runtime

**ADW progress event**:
A discrete typed mid-run signal emitted by ADW orchestration (step enter/result, wire miss, attempt counters, and similar) for Host operators and later sinks — not a separate ADW graph.
_Avoid_: Observability as a domain noun; equating with Cursor SDK stream fan-out; an “Observability ADW” whose job is telemetry; treating free-text-only log lines as the canonical model

**Skill**:
Agent-facing process guidance (prompts/procedures), not the Runtime or the ADW control plane. Configured **Agents** are **role-skill-bound**: the Agent carries root skill(s) from a **Skill pack** plus transitive closure; ADW/Runtime loads that into the **Agent session**. Build’s root is `/implement` (`tdd` and others enter via that closure). Skills do not own pass/fail routing.
_Avoid_: Workflow, ADW; hoping the agent “just remembers” the skill with no Agent binding; treating `/tdd` as a second Build root alongside `/implement` when it is already in implement’s closure

**Role skill binding**:
Policy on a configured **Agent** that names the root skill(s) that role must run, plus transitive closure from the **Skill pack**. Content lives in skills; the Agent carries the binding; Runtime/ADW loads it into the **Agent session**. Suggested skills inside a `/to-plan` (or similar) artifact are optional hints — they do not replace this binding (important when Organizations customize Agents later).
_Avoid_: Encoding each skill as its own ADW graph; dumping the entire pack into every role with no binding; re-declaring bindings on every parent ADW; letting plan suggestions silently override the Agent bind

**Skill pack**:
A rooted set of Skill files available to a configured **Agent** (default on target cwd: `.agents/skills`). **Host CLI** also ships a bundled pack (`packages/adw/host-skill-pack`) so Review’s `/adw-review` is available via Cursor `local.dirs` even when the target repo lacks that skill. Build still uses the target cwd pack (`/implement`, …). Organization-scoped custom packs are a later hosted overlay on the same Agent primitive.
_Avoid_: Shipping a different AgentProvider per tenant; requiring every target repo to vendor Factory-only skills like `/adw-review`

**Runtime**:
Our Effect TypeScript layer (`packages/runtime`) that owns sandbox lifecycle and agent providers (e.g. Cursor SDK). The Factory control plane calls the Runtime; skills do not.
_Avoid_: Sandcastle, orchestrator (ADW owns routing; Runtime owns isolation/agents)

**SandboxProvider**:
A pluggable adapter that creates/execs/destroys sandboxes. Local options include a **Host sandbox** (this machine as the box) and classic Docker; later BYO cloud such as Vercel. Credentials are per run / per Organization. ADW always goes through a sandbox pointer — never calls the agent provider with “no sandbox.”
_Avoid_: Docker Sandboxes / `sbx` as the only path (optional later; requires Docker login); bypassing SandboxProvider for host spikes

**Host sandbox**:
A `SandboxProvider` backend where the sandbox **is** the host process/filesystem (local `exec`). Valid default until Docker lands, and a lasting option for single-ADW-at-a-time local use without containers. Not a second orchestration path — same warm-sandbox rules, weaker isolation.
_Avoid_: Treating host runs as outside the Runtime; multi-ticket parallel on one host sandbox (one ADW at a time)

**Warm sandbox**:
One sandbox per ticket/task, kept alive for the whole ADW so Build, Test agent, and Review share filesystem, installs, and agent session state. On Host sandbox, that means one active ADW on the machine at a time.
_Avoid_: New sandbox per agent step

**Workspace provision**:
Deterministic ADW setup inside the warm sandbox **before** Build: ensure a git worktree exists, create/checkout the ticket branch (orchestration-owned, e.g. `adw/<ticketId>`), then run a **locked install** when a lockfile is present (e.g. `pnpm install` for this monorepo). **Host:** reuse an already-cloned path when `.git` is present (skip clone; still branch + install as needed). **Cloud/empty box:** Git host clone (+ install) using per-run credentials. Provision failure → ADW `failed` with no agent run. Not an LLM step; not Ship.
_Avoid_: Assuming every sandbox already has the repo; making the Build agent own clone/branch/install; treating Host and cloud as different ADW graphs; requiring a custom bootstrap script in v0

**TicketIntake**:
Tracker-agnostic Host operator seam: given a ready-ticket reference, produce Minimal ADW `ticketId` + prompt (and minimal metadata). **GitHub Issues** is the first adapter (`gh`, gate on `ready-for-agent`). Lives on the Host CLI / operator path **outside** `runMinimalAdw` — feeds the Initial prompt; not a Build/Test/Review/Ship node. Manual `--ticket` / `--prompt` bypasses it. Other trackers (e.g. Jira) are later adapters on the same seam.
_Avoid_: Treating intake as a Minimal ADW graph step; full triage/grill productization; requiring paste-by-hand as the only Host path once the GitHub adapter exists

**Sandcastle**:
Prior-art reference only ([mattpocock/sandcastle](https://github.com/mattpocock/sandcastle)) — not part of this Factory’s stack. Do not depend on `@ai-hero/sandcastle` for product paths.
_Avoid_: Treating Sandcastle as our Runtime or control plane

**Organization**:
The tenancy unit for membership, roles, and scoped data in the hosted/multi-user product.
_Avoid_: Tenant (synonym we allow in ops talk, but prefer Organization in product language), team (a sub-group inside an Organization when we use it), account
