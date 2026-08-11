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
The leaf ADW: **Build agent** ↔ **Test agent** (gate) → **Review agent** → **Ship** (ADR-0007 shape). Own Build/Review attempt caps and warm-sandbox loop.
_Avoid_: Calling this Feature; dropping Review from Minimal

**Feature ADW**:
A composite ADW: **Planner Agent** then nested **Minimal ADW**. Shares one warm sandbox with the child. Ship stays on Minimal after Review pass. Planner binds `/codebase-design` + `/domain-modeling` and emits a **`/to-plan`** artifact (plan.md-like + handoff discipline) for Minimal. Provisional nested routing: Agent Review-fail stays local inside Minimal; Minimal exhaustion bubbles to Planner for **plan-only** re-entry (not code edits) — see `docs/VISION.md`.
_Avoid_: Planner-as-ADW when it is only one Agent; renaming Minimal to Feature; treating Agent Review-fail like HITL Engineer Review→Planner; Planner editing code on replan; treating suggested skills in a plan as overriding the Agent’s Role skill binding

**Agent** (configured):
A reusable LLM role primitive with its **Skill pack** and **Role skill binding** (e.g. Build, Review, Planner). ADWs compose Agents and nested ADWs; Agents do not embed ADW routing. Distinct from **Agent session** (one running thread).
_Avoid_: Letting each ADW re-own skill policy; equating Agent with Agent session or with the whole ADW; wrapping one Agent in a throwaway ADW just for symmetry

**Gate**:
A deterministic pass/fail check owned by orchestration (lint, typecheck, test, policy). Green advances the ADW; red routes back.
_Avoid_: Validation (too vague), agent self-check

**Build attempt**:
One Build agent run (create or resume) in the **Build↔Test** loop only. Own counter (v0 default cap **5**), **separate from Review attempts**. Test-fail → resume Build spends one Build attempt. Review-fail → resume Build does **not** spend a Build attempt — that path is charged only as a Review attempt when Review ran.
_Avoid_: One shared budget with Review; counting Review→Build resumes as Build attempts; counting Test agent execs as attempts; unbounded Test→Build resume

**Review attempt**:
One Review agent **create** when entering Review from the Build/Test path (new session). Own counter (v0 default cap **3**), **separate from Build attempts**. Schema-repair **resumes** of that session do **not** spend an extra Review attempt; they use an inner schema-resume cap (v0 default **3**) per Review session. Caps Review↔Build thrash; exhaust Review attempts or schema-resume cap → ADW `failed` even if Build attempts remain. After a valid Review fail, resuming Build with the fail report does not decrement the Build counter.
_Avoid_: Sharing one counter with Build↔Test; charging Review→Build or schema resumes to the Build cap; charging every schema resume as a new Review attempt; unlimited Review or schema-repair retries

**Build agent**:
The LLM agent session that implements the ticket in the warm sandbox. Its `AgentSession` is the durable resume target when the Test agent fails or Review fails.
_Avoid_: Treating Review’s session as the place to keep coding

**Test agent**:
A coded ADW graph node that runs **check-only** gates (lint, format check, typecheck, unit tests, policy) via the Runtime — not an LLM. Independent checks run **in parallel**; any red resumes Build with a **combined** fail report (all failing gates’ output), same session and sandbox. Pass all → Review.
_Avoid_: Test-writing agent, QA agent (unless we add a separate LLM role later); fail-fast on first red; mutating format/write steps inside the Test agent

**Review agent**:
The LLM agent that critiques the change after the Test agent passes — same _shape_ as a Bugbot-style review (findings with location/severity), but orchestration does **not** auto-fix. Entering Review from Build/Test always starts a **new** `AgentSession` in the same warm sandbox; create prompt includes the **ReviewOutput** wire contract. On **schema miss** (output fails decode), orchestration **resumes that Review session** with schema guidance until a valid **Review verdict** or the inner schema-resume cap. A valid **fail** verdict’s fail report is the feedback when resuming Build.
_Avoid_: Same-session Review-as-Build; new Build session on every Review fail; treating schema-repair resume like content-fail→Build; Review that only chats with no machine-readable verdict; Review that applies fixes itself in the Minimal ADW

**Ship**:
After Review **pass**, orchestration runs the Ship step via the **Git host**: **push** the ticket branch from the warm sandbox, then open a pull/merge request. Build only commits locally; Test/Review do not push. v0 result: **`shipped`** only when a PR/MR exists (URL recorded); **`ready_for_pr`** when Review passed but push or PR open skipped/failed. Do not burn Build/Review attempts retrying Ship.
_Avoid_: Equating shipped with merged; requiring Docker for Ship; failing the whole ADW solely because Ship could not open a PR; hard-coding GitHub as the only forge forever; making the Build agent responsible for push/PR

**Git host**:
Pluggable forge for clone/push/PR-MR (GitHub via `gh` + `GH_TOKEN` first; later GitLab/Bitbucket/etc. behind the same seam). Lives in its own package seam (`packages/git-host` or equivalent): ADW decides _when_ to provision/Ship; the adapter decides _how_. Not part of Runtime (sandbox/agents) and not raw `gh` calls inside the ADW loop.
_Avoid_: Assuming GitHub-only; calling every forge “GitHub”; baking `gh` into Runtime or ADW control-flow code; putting clone/push inside `AgentProvider`

**Review verdict**:
Structured Review output (`ReviewOutput`) orchestration parses: **pass** or **fail**, plus on fail a fail report (findings + reasons) used as Build-resume feedback. Create-time prompt states this wire contract. Malformed/unknown output is a **schema miss**: resume Review with decode guidance (not Build); only a **valid fail** resumes Build. Dismiss-with-reason is a human/later concern — once valid, v0 Review either fails (block + feedback) or passes (advance to Ship).
_Avoid_: Free-text-only Review; routing schema miss to Build; trusting Review to merge/ship; treating false-positive dismissal as v0 ADW logic

**Agent session**:
A resumable LLM thread owned by an `AgentProvider`, identified by an **opaque** `sessionId` the orchestration stores as a pointer. The Cursor adapter maps that id to whatever `@cursor/sdk` needs for create/resume; ADW types do not expose Cursor-specific field names. Build keeps one durable session per ticket; Review keeps one session per Review attempt (new on entry from Build/Test; resumable for schema repair).
_Avoid_: Equating session with sandbox; putting `cursorAgentId` (or similar) on ADW/domain types; treating session id format as domain knowledge

**ADW progress event**:
A discrete typed mid-run signal emitted by ADW orchestration (step enter/result, schema miss, attempt counters, and similar) for Host operators and later sinks — not a separate ADW graph.
_Avoid_: Observability as a domain noun; equating with Cursor SDK stream fan-out; an “Observability ADW” whose job is telemetry; treating free-text-only log lines as the canonical model

**Skill**:
Agent-facing process guidance (prompts/procedures), not the Runtime or the ADW control plane. Configured **Agents** are **role-skill-bound**: the Agent carries root skill(s) from a **Skill pack** plus transitive closure; ADW/Runtime loads that into the **Agent session**. Build’s root is `/implement` (`tdd` and others enter via that closure). Skills do not own pass/fail routing.
_Avoid_: Workflow, ADW; hoping the agent “just remembers” the skill with no Agent binding; treating `/tdd` as a second Build root alongside `/implement` when it is already in implement’s closure

**Role skill binding**:
Policy on a configured **Agent** that names the root skill(s) that role must run, plus transitive closure from the **Skill pack**. Content lives in skills; the Agent carries the binding; Runtime/ADW loads it into the **Agent session**. Suggested skills inside a `/to-plan` (or similar) artifact are optional hints — they do not replace this binding (important when Organizations customize Agents later).
_Avoid_: Encoding each skill as its own ADW graph; dumping the entire pack into every role with no binding; re-declaring bindings on every parent ADW; letting plan suggestions silently override the Agent bind

**Skill pack**:
A rooted set of Skill files available to a configured **Agent** (default for this Factory: `.agents/skills`). Organization-scoped custom packs are a later hosted overlay on the same Agent primitive.
_Avoid_: Shipping a different AgentProvider per tenant; baking one repo’s skills into the AgentProvider binary

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
