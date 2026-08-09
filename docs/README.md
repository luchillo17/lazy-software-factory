# Docs

Design notes and ADRs for the factory live here. Domain language: [`CONTEXT.md`](../CONTEXT.md).

## ADRs

| ADR                                                      | Decision                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| [0001](./adr/0001-skills-runtime-adw-split.md)           | Skills / Runtime / ADW stay separate (Sandcastle not in stack)       |
| [0002](./adr/0002-nx-monorepo-extractable-packages.md)   | Nx from the start; extractable packages (`adw`, `runtime`)           |
| [0003](./adr/0003-runtime-credentials-per-run.md)        | Runtime credentials per run; root `.env` for local                   |
| [0004](./adr/0004-convex-better-auth-logical-tenancy.md) | Convex + Better Auth, logical org tenancy (direction)                |
| [0005](./adr/0005-agents-propose-orchestration-gates.md) | Agents may run checks; orchestration owns hard gates                 |
| [0006](./adr/0006-factory-is-self-building.md)           | Factory is self-building (ADWs develop this repo)                    |
| [0007](./adr/0007-minimal-adw-build-test-review.md)      | Minimal ADW: Build → Test agent → Review                             |
| [0008](./adr/0008-runtime-docker-cursor-sdk.md)          | Effect Runtime: classic Docker + Cursor SDK; Sandcastle out of stack |

## Open decisions

- **Nx project graph** — `packages/adw` and `packages/runtime` stubbed; more apps/packages later.
- **Hosted cloud SaaS** — product layer later; core stays usable local/on-prem (ADR-0002).

Agent skills config: [`AGENTS.md`](../AGENTS.md) (SoT) → [`docs/agents/`](./agents/). Skill: [luchillo17/gh-stack-compact](https://github.com/luchillo17/gh-stack-compact).

## Next setup

1. Implement Runtime Docker adapter + Cursor SDK resume (ADR-0008)
2. Wire minimal ADW loop (ADR-0007) for self-building
3. Enable GitHub **stacked PRs** on the repo if `gh stack` reports exit 9
