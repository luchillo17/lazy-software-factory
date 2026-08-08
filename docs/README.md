# Docs

Design notes and ADRs for the factory live here. Domain language: [`CONTEXT.md`](../CONTEXT.md).

## ADRs

| ADR                                                         | Decision                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| [0001](./adr/0001-skills-sandcastle-orchestration-split.md) | Skills / Sandcastle / orchestration stay separate         |
| [0002](./adr/0002-nx-monorepo-extractable-packages.md)      | Nx from the start; extractable packages (names TBD)       |
| [0003](./adr/0003-sandcastle-runtime-credentials.md)        | Sandcastle credentials per run, not one server per tenant |
| [0004](./adr/0004-convex-better-auth-logical-tenancy.md)    | Convex + Better Auth, logical org tenancy (direction)     |
| [0005](./adr/0005-agents-propose-orchestration-gates.md)    | Agents may run checks; orchestration owns hard gates      |
| [0006](./adr/0006-factory-is-self-building.md)              | Factory is self-building (ADWs develop this repo)         |

## Open decisions

- **Concrete Nx project graph** — no packages named yet; add when first real packages land.
- **Hosted cloud SaaS** — product layer later; core stays usable local/on-prem (ADR-0002).

Agent skills config: [`AGENTS.md`](../AGENTS.md) (SoT) → [`docs/agents/`](./agents/).

## Next setup

1. Sandcastle init (Docker on WSL)
2. Nx workspace bootstrap when ready to add the first package
3. Custom ADW orchestration after runtime + skills wiring
