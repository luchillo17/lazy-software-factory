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
An AI developer workflow — a coded sequence of agent steps and deterministic gates for a unit of work (see `packages/adw`).
_Avoid_: Pipeline, agent loop (a single agent chat iteration is not the whole ADW)

**Gate**:
A deterministic pass/fail check owned by orchestration (lint, typecheck, test, policy). Green advances the ADW; red routes back.
_Avoid_: Validation (too vague), agent self-check

**Build attempt**:
One Build agent run (create or resume) in the **Build↔Test** loop only. Own counter (v0 default cap **5**), **separate from Review attempts**. Test-fail → resume Build spends one Build attempt. Review-fail → resume Build does **not** spend a Build attempt — that path is charged only as a Review attempt when Review ran.
_Avoid_: One shared budget with Review; counting Review→Build resumes as Build attempts; counting Test agent execs as attempts; unbounded Test→Build resume

**Review attempt**:
One Review agent run (always a new session). Own counter (v0 default cap **3**), **separate from Build attempts**. Caps Review↔Build thrash; exhaust → ADW `failed` even if Build attempts remain. After Review fail, resuming Build with the fail report does not decrement the Build counter.
_Avoid_: Sharing one counter with Build↔Test; charging Review→Build to the Build cap; unlimited Review retries

**Build agent**:
The LLM agent session that implements the ticket in the warm sandbox. Its `AgentSession` is the durable resume target when the Test agent fails or Review fails.
_Avoid_: Treating Review’s session as the place to keep coding

**Test agent**:
A coded ADW graph node that runs **check-only** gates (lint, format check, typecheck, unit tests, policy) via the Runtime — not an LLM. Independent checks run **in parallel**; any red resumes Build with a **combined** fail report (all failing gates’ output), same session and sandbox. Pass all → Review.
_Avoid_: Test-writing agent, QA agent (unless we add a separate LLM role later); fail-fast on first red; mutating format/write steps inside the Test agent

**Review agent**:
The LLM agent that critiques the change after the Test agent passes — same _shape_ as a Bugbot-style review (findings with location/severity), but orchestration does **not** auto-fix. Always a **new** `AgentSession` in the same warm sandbox. Emits a structured **Review verdict**; on fail, the fail report is the feedback passed when resuming Build.
_Avoid_: Same-session Review-as-Build; new Build session on every Review fail; Review that only chats with no machine-readable verdict; Review that applies fixes itself in the minimal ADW

**Ship**:
After Review **pass**, orchestration runs the Ship step via the **Git host**: **push** the ticket branch from the warm sandbox, then open a pull/merge request. Build only commits locally; Test/Review do not push. v0 result: **`shipped`** only when a PR/MR exists (URL recorded); **`ready_for_pr`** when Review passed but push or PR open skipped/failed. Do not burn Build/Review attempts retrying Ship.
_Avoid_: Equating shipped with merged; requiring Docker for Ship; failing the whole ADW solely because Ship could not open a PR; hard-coding GitHub as the only forge forever; making the Build agent responsible for push/PR

**Git host**:
Pluggable forge for clone/push/PR-MR (GitHub via `gh` + `GH_TOKEN` first; later GitLab/Bitbucket/etc. behind the same seam). Lives in its own package seam (`packages/git-host` or equivalent): ADW decides _when_ to provision/Ship; the adapter decides _how_. Not part of Runtime (sandbox/agents) and not raw `gh` calls inside the ADW loop.
_Avoid_: Assuming GitHub-only; calling every forge “GitHub”; baking `gh` into Runtime or ADW control-flow code; putting clone/push inside `AgentProvider`

**Review verdict**:
Structured Review output orchestration parses: **pass** or **fail**, plus on fail a fail report (findings + reasons) used as Build-resume feedback. Malformed/unknown verdict counts as fail and spends a Review attempt. Dismiss-with-reason is a human/later concern — v0 Review either fails (block + feedback) or passes (advance to Ship).
_Avoid_: Free-text-only Review; trusting Review to merge/ship; treating false-positive dismissal as v0 ADW logic

**Agent session**:
A resumable LLM thread owned by an `AgentProvider`, identified by an **opaque** `sessionId` the orchestration stores as a pointer. The Cursor adapter maps that id to whatever `@cursor/sdk` needs for create/resume; ADW types do not expose Cursor-specific field names. Build keeps one durable session per ticket; Review may have its own short-lived session.
_Avoid_: Equating session with sandbox; putting `cursorAgentId` (or similar) on ADW/domain types; treating session id format as domain knowledge

**Skill**:
Agent-facing process guidance (prompts/procedures), not the Runtime or the ADW control plane. LLM agent roles in an ADW are **role-skill-bound**: orchestration injects the mandatory skill set for that role at session bootstrap (e.g. Build → `/implement`; Review → review skills). Skills do not own pass/fail routing.
_Avoid_: Workflow, ADW; hoping the agent “just remembers” the skill with no orchestration bind

**Role skill binding**:
The ADW/control-plane policy that maps an LLM agent role (Build, Review, …) to the skill set that role must always run. Content lives in skills; the binding and injection live in orchestration.
_Avoid_: Encoding each skill as its own ADW graph; putting skill selection only inside Runtime/AgentProvider; treating skill use as optional agent whim

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

**Sandcastle**:
Prior-art reference only ([mattpocock/sandcastle](https://github.com/mattpocock/sandcastle)) — not part of this Factory’s stack. Do not depend on `@ai-hero/sandcastle` for product paths.
_Avoid_: Treating Sandcastle as our Runtime or control plane

**Organization**:
The tenancy unit for membership, roles, and scoped data in the hosted/multi-user product.
_Avoid_: Tenant (synonym we allow in ops talk, but prefer Organization in product language), team (a sub-group inside an Organization when we use it), account
