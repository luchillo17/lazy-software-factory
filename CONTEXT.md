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
An AI developer workflow — a coded sequence of agent steps and deterministic gates for a unit of work.
_Avoid_: Pipeline, agent loop (Sandcastle’s loop is a runtime primitive, not the whole ADW)

**Gate**:
A deterministic pass/fail check owned by orchestration (lint, typecheck, test, policy). Green advances the ADW; red routes back.
_Avoid_: Validation (too vague), agent self-check

**Skill**:
Agent-facing process guidance (prompts/procedures), not the runtime or the control plane.
_Avoid_: Workflow, ADW

**Sandcastle**:
Runtime primitives for sandboxed, branched, parallel agent runs — not the factory’s control plane.
_Avoid_: Factory, orchestrator

**Organization**:
The tenancy unit for membership, roles, and scoped data in the hosted/multi-user product.
_Avoid_: Tenant (synonym we allow in ops talk, but prefer Organization in product language), team (a sub-group inside an Organization when we use it), account
