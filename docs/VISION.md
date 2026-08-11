# Factory vision + v0/v1 cut

Canonical product vision for the extractable open-source **Factory**. Glossary lives in [`CONTEXT.md`](../CONTEXT.md); hard decisions live in [`docs/adr/`](adr/). This file is the cut and north star — not a second glossary.

Status: **shape locked**; section bodies marked TBD are filled by open wayfinder tickets on [Factory vision + v0 cut](https://github.com/luchillo17/lazy-software-factory/issues/26).

## 1. North star

Extractable open-source **Factory** (`packages/runtime` + `packages/adw`, plus git-host seam): orchestrated AI developer workflows with hard gates, usable locally, on-prem, or as packages. The Factory is **self-building** — it develops this repo through its own ADWs.

Hosted multi-org **Organization** Platform is a later packaging of the same core (org-scoped credentials and compute), not the v0 lead. Sketch only in §5.

## 2. Domain primitives

- **Agent** (configured): reusable LLM role primitive; owns **Skill pack** + **Role skill binding** (plus transitive skill refs). Distinct from **Agent session**.
- **Skill pack**: default root `.agents/skills`. Organization custom packs = later hosted overlay on the same Agent primitive.
- **ADW**: composable graph of Agents, deterministic gates, and/or nested ADWs. Never wrap a single Agent as a one-node ADW.
- **Minimal ADW**: Build ↔ Test → Review → Ship (ADR-0007 shape).
- **Feature ADW**: Planner Agent → nested Minimal ADW (one shared **warm sandbox**; Ship stays on Minimal after Review pass).
- **Role skill binding**: soft guidance loaded into the session (Cursor SDK has no skills API — binding invented in ADW prompts; pack discovery is workspace filesystem). Hard pass/fail stays ADW gates (ADR-0001).

Default bindings (charting lock; substance may refine):

| Agent   | Binding                                                                                                                      |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Build   | Root `/implement`; load transitive closure (`tdd`, `code-review`, `codebase-design`, conditional `setup-matt-pocock-skills`) |
| Review  | Bugbot-shaped only in v0 — no duplicate `/code-review`; no always-on `/improve-codebase-architecture`                        |
| Planner | TBD — [Define Planner Agent default skill bindings](https://github.com/luchillo17/lazy-software-factory/issues/34)           |

## 3. v0 cut

Acceptance criteria for **Minimal ADW** v0 green (self-building this repo on **Host sandbox**). Locked in [Define v0 Minimal ADW acceptance cut](https://github.com/luchillo17/lazy-software-factory/issues/28).

### Must pass

- [ ] **Automated Minimal ADW tests** cover provision → Build ↔ Test → Review → Ship on Host (adapters/fakes OK), including:
  - [ ] Happy path can yield **`shipped`** (PR URL recorded)
  - [ ] Ship miss yields **`ready_for_pr`** without failing the agent loop / burning Build or Review attempts (ADR-0011)
  - [ ] Build↔Test and Review attempt caps behave per ADR-0009
- [ ] **One documented manual self-build** on this repo: a real `ready-for-agent` Issue runs through Host Minimal ADW and reaches **`shipped`** (live PR)
- [ ] **Intake:** thin operator/CLI (or app) starts Minimal ADW from one GitHub Issue labelled `ready-for-agent` (Issue id + body → `ticketId` / prompt) — not full triage automation
- [ ] **Build Role skill binding:** session bootstrap injects root `/implement` and its transitive skill closure (includes `tdd`, `code-review`, …); pack root `.agents/skills` present on agent cwd
- [ ] **Review Role skill binding:** Bugbot-shaped review bind only (no second `/code-review` pass; no always-on `/improve-codebase-architecture`)
- [ ] **Extractability note:** short consumer doc on depending on `runtime` / `adw` (+ git-host seam) outside monorepo apps — DX rough OK; npm publish **not** required

### Explicitly not required for v0

- Parallel Docker/cloud **SandboxProvider** (see §4)
- **Feature ADW** / Planner Agent
- Grill/wayfinder as ADW nodes (stay HITL upstream)
- Multi-org hosted control plane

## 4. v0→v1 seam (parallel sandboxes)

**TBD** — [Place parallel SandboxProvider on v0/v1 seam](https://github.com/luchillo17/lazy-software-factory/issues/29).

Locked intent: Host is valid for single-ticket local self-build; vision requires a parallel warm-sandbox **SandboxProvider** (Docker or equivalent) before hosted multi-org compute.

## 5. v1+ / hosted Organization sketch

Non-goals for v0 detail. Later packaging may add Organization tenancy, org-scoped credentials/compute, and Skill pack overlays for cloud ADW runs. Auth, billing edges, and control-plane implementation are out of this vision’s build scope (see §6).

## 6. Out of scope

- Billing / commercial packaging work in this effort.
- Non-Cursor **AgentProvider** implementations for this map.
- Multi-org control plane **implementation** (sketch only above).
- Always-on `/improve-codebase-architecture` inside every Review.
- Specialized intake product ADWs (grill/triage as shipped ADWs) — compose principle + Feature/Minimal naming are in scope; building those intake ADWs is not.

## 7. Open decisions

Pointers to open children of [Factory vision + v0 cut](https://github.com/luchillo17/lazy-software-factory/issues/26):

| Topic                                                 | Ticket                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| Parallel SandboxProvider seam                         | [#29](https://github.com/luchillo17/lazy-software-factory/issues/29) |
| Feature Review-fail routing (local vs Planner bubble) | [#33](https://github.com/luchillo17/lazy-software-factory/issues/33) |
| Planner Agent skill bindings                          | [#34](https://github.com/luchillo17/lazy-software-factory/issues/34) |

Closed on this map: vision shape (#27), v0 Minimal acceptance (#28), skill-pack research (#30), Build skill closure (#31), Feature Review-fail eval (#32).
