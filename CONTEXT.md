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

**Test agent**:
A coded ADW graph node that runs tests (and related checks) via the Runtime — not an LLM. Fail feeds output back to the Build agent (same session, same sandbox); pass advances to Review.
_Avoid_: Test-writing agent, QA agent (unless we add a separate LLM role later)

**Skill**:
Agent-facing process guidance (prompts/procedures), not the Runtime or the ADW control plane.
_Avoid_: Workflow, ADW

**Runtime**:
Our Effect TypeScript layer (`packages/runtime`) that owns sandbox lifecycle and agent providers (e.g. Cursor SDK). The Factory control plane calls the Runtime; skills do not.
_Avoid_: Sandcastle, orchestrator (ADW owns routing; Runtime owns isolation/agents)

**SandboxProvider**:
A pluggable adapter that creates/execs/destroys sandboxes (local classic Docker by default; later BYO cloud such as Vercel). Credentials are per run / per Organization.
_Avoid_: Docker Sandboxes / `sbx` as the only path (optional later; requires Docker login)

**Warm sandbox**:
One sandbox per ticket/task, kept alive for the whole ADW so Build, Test agent, and Review share filesystem, installs, and agent session state.
_Avoid_: New sandbox per agent step

**Sandcastle**:
Prior-art reference only ([mattpocock/sandcastle](https://github.com/mattpocock/sandcastle)) — not part of this Factory’s stack. Do not depend on `@ai-hero/sandcastle` for product paths.
_Avoid_: Treating Sandcastle as our Runtime or control plane

**Organization**:
The tenancy unit for membership, roles, and scoped data in the hosted/multi-user product.
_Avoid_: Tenant (synonym we allow in ops talk, but prefer Organization in product language), team (a sub-group inside an Organization when we use it), account
