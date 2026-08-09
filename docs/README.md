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

- **Nx project graph** — workspace bootstrapped; apps/packages empty aside from placeholders.
- **Hosted cloud SaaS** — product layer later; core stays usable local/on-prem (ADR-0002).

Agent skills config: [`AGENTS.md`](../AGENTS.md) (SoT) → [`docs/agents/`](./agents/). Skill: [luchillo17/gh-stack-compact](https://github.com/luchillo17/gh-stack-compact).

## Next setup

1. ~~Sandcastle init (Docker on WSL)~~ — `.sandcastle/` + image `sandcastle:lazy-software-factory`; set `.sandcastle/.env` then `pnpm sandcastle`
2. Custom ADW orchestration after runtime wiring
3. Enable GitHub **stacked PRs** on the repo if `gh stack` reports exit 9
