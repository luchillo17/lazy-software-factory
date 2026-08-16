# Docs

Design notes and ADRs for the factory live here. Domain language: [`CONTEXT.md`](../CONTEXT.md). Product cut: [`VISION.md`](./VISION.md).

## Consumer notes

- **[Host Minimal self-build (v0)](./host-self-build.md)** — `ready-for-agent` Issue → `pnpm adw:host -- --issue` → live `shipped` PR
- **[Extractability (v0)](./extractability.md)** — depend on `runtime` / `adw` / `git-host` from outside monorepo apps (rough DX OK; npm publish not required)

## ADW flow diagrams

| ADW             | Human layout                                                    | Agent graph          | Notes                                                                                                           |
| --------------- | --------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Minimal ADW** | [ADR-0007](./adr/0007-minimal-adw-build-test-review.md) Mermaid | same Mermaid         | TicketIntake (Host CLI, optional) → Prompt → Build ↔ SeamConfirm ↔ Test → Agent Review → Ship → Engineer Review |
| **Feature ADW** | [SVG](./diagrams/feature-adw.svg) · [VISION §2](./VISION.md)    | Mermaid in VISION §2 | Planner → nested Minimal; Eng fail → Planner. Own ADR when Feature locks                                        |
| Ship statuses   | [ADR-0011](./adr/0011-git-host-ship-statuses.md)                | —                    | Points at ADR-0007 for the spine; `shipped` = PR opened, not merged                                             |

Do **not** draw Merge/deploy after Ship in these diagrams — merge is HITL (Engineer Review / humans), outside Minimal automation.

### Format: Mermaid vs SVG

| Audience                | Format                                                            | Role                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Agents**              | **Mermaid** in the markdown source                                | **Prefer this** for nodes, edges, labels, routing. Text graph beats SVG coordinates.                                     |
| **Humans (GH preview)** | **SVG** under [`docs/diagrams/`](./diagrams/) when layout matters | Pixel-stable layout (nested ADWs, HITL back-edges). Optional Excalidraw `.excalidraw` = edit source only, not agent SoT. |

When **both** exist for the same ADW (Feature): keep them **semantically aligned** (same nodes/edges/labels). Humans trust SVG layout; agents trust Mermaid source. Do **not** make agents parse SVG geometry.

**Mermaid layout limit (humans only):** GH/dagre may scramble charts with intake back-edges (e.g. Engineer Review fail → Planner). Still keep that edge in Mermaid for agents; humans use the SVG for spatial layout. Prefer `%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%` when Mermaid is also the human view (Minimal). Local fail → Build dashed edges OK.

GH SVG embeds need explicit `width`/`height` + SVG 1.1 (`orient="auto"`, no exotic attrs).

GitHub image embed is SoT for SVG preview. Colors below apply to **both** Mermaid `classDef` and SVG fills/strokes.

**Shared legend image:** [`docs/diagrams/adw-legend.svg`](./diagrams/adw-legend.svg). Embed in Markdown next to any ADW chart (Mermaid or SVG):

```markdown
![ADW diagram legend](diagrams/adw-legend.svg)
```

Do **not** bake the legend into flow SVGs (no `<image href=…>` inside charts — fragile on GH). Do **not** duplicate a Mermaid Legend subgraph when the page already embeds `adw-legend.svg`.

### ADW diagram colors

Shared palette for ADW flowcharts (Mermaid + SVG). Reuse these role names and hexes — do not invent per-diagram colors. Hex SoT matches [`adw-legend.svg`](./diagrams/adw-legend.svg).

| Role (`classDef`) | Meaning                                    | Fill      | Stroke    | Text      | Typical nodes                                          |
| ----------------- | ------------------------------------------ | --------- | --------- | --------- | ------------------------------------------------------ |
| `human`           | HITL                                       | `#3b1a1a` | `#fca5a5` | `#fee2e2` | Initial prompt, Engineer Review (stadium / pill)       |
| `llm`             | LLM agent                                  | `#3b2f1a` | `#fbbf24` | `#fef3c7` | Planner, Build                                         |
| `gate`            | Test (**Code agent**) / deterministic seam | `#1a2e1a` | `#86efac` | `#dcfce7` | Test agent; SeamConfirm agent; TicketIntake (Host CLI) |
| `agent`           | Agent Review (LLM judgment)                | `#2e1a3b` | `#c4b5fd` | `#ede9fe` | Agent Review                                           |
| `ship`            | Ship (**Code agent**)                      | `#1a2e2e` | `#5eead4` | `#ccfbf1` | Ship agent                                             |

Test and SeamConfirm share the **gate** color; Ship keeps its own. Kind lives in the node label + [`CONTEXT.md`](../CONTEXT.md); color marks role in the flow.

```text
classDef human fill:#3b1a1a,stroke:#fca5a5,color:#fee2e2
classDef llm fill:#3b2f1a,stroke:#fbbf24,color:#fef3c7
classDef gate fill:#1a2e1a,stroke:#86efac,color:#dcfce7
classDef agent fill:#2e1a3b,stroke:#c4b5fd,color:#ede9fe
classDef ship fill:#1a2e2e,stroke:#5eead4,color:#ccfbf1
```

## ADRs

| ADR                                                            | Decision                                                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| [0001](./adr/0001-skills-runtime-adw-split.md)                 | Skills / Runtime / ADW stay separate (Sandcastle not in stack)       |
| [0002](./adr/0002-nx-monorepo-extractable-packages.md)         | Nx from the start; extractable packages (`adw`, `runtime`)           |
| [0003](./adr/0003-runtime-credentials-per-run.md)              | Runtime credentials per run; root `.env` for local                   |
| [0004](./adr/0004-convex-better-auth-logical-tenancy.md)       | Convex + Better Auth, logical org tenancy (direction)                |
| [0005](./adr/0005-agents-propose-orchestration-gates.md)       | Agents may run checks; orchestration owns hard gates                 |
| [0006](./adr/0006-factory-is-self-building.md)                 | Factory is self-building (ADWs develop this repo)                    |
| [0007](./adr/0007-minimal-adw-build-test-review.md)            | Minimal ADW: TicketIntake → Prompt → Build → Test → Review → Ship    |
| [0008](./adr/0008-runtime-docker-cursor-sdk.md)                | Effect Runtime: classic Docker + Cursor SDK; Sandcastle out of stack |
| [0009](./adr/0009-adw-attempt-caps-review-verdict.md)          | Build/Review caps + ReviewOutput; wire miss resumes Review           |
| [0010](./adr/0010-workspace-provision-before-build.md)         | Workspace provision before Build                                     |
| [0011](./adr/0011-git-host-ship-statuses.md)                   | Git host + Ship agent: `ShipInput` → `shipped` / `ready_for_pr`      |
| [0012](./adr/0012-vendor-effect-source-for-agents.md)          | Vendored Effect source for agents                                    |
| [0013](./adr/0013-test-agent-parallel-check-gates.md)          | Test agent: parallel check-only gates + full fail report             |
| [0014](./adr/0014-structured-agent-output-via-custom-tools.md) | Structured LLM Agent output via local customTools (tool-only wire)   |

## Open decisions

- **Nx project graph** — `packages/adw` and `packages/runtime` stubbed; more apps/packages later.
- **Hosted cloud SaaS** — product layer later; core stays usable local/on-prem (ADR-0002).

Agent skills config: [`AGENTS.md`](../AGENTS.md) (SoT) → [`docs/agents/`](./agents/). Skill: [luchillo17/gh-stack-compact](https://github.com/luchillo17/gh-stack-compact).

## Next setup

1. Harden Host dogfood loop (`pnpm adw:host`) once parallel Test gates + Docker land
2. Implement Runtime Docker adapter + Cursor SDK resume (ADR-0008) for parallel ADWs
3. Enable GitHub **stacked PRs** on the repo if `gh stack` reports exit 9
