# lazy-software-factory

Open-source **AI developer workflows** (a software factory) built on:

- [Sandcastle](https://github.com/mattpocock/sandcastle) — sandbox / branch / parallel agent **primitives**
- [mattpocock/skills](https://github.com/mattpocock/skills) — engineering **process** (grill → tickets → TDD → review)
- IndyDevDan-style ADWs — **code owns the gates** (lint / typecheck / test / route); agents own judgment

The goal is a factory you can run locally (WSL + Docker recommended), with orchestration you own in TypeScript — not a single mega-skill that lints, tests, and reviews itself. It should be **self-building**: once the loop exists, use this factory’s ADWs to develop this repo’s apps and packages.

## Status

Early bootstrap. Public so people can contribute while the shape settles.

**Decided (see [docs/adr](./docs/adr/) and [CONTEXT.md](./CONTEXT.md)):** Nx from the start; extractable packages; self-building factory; Convex + Better Auth direction; logical org tenancy.

**Still open:** more packages/apps in the Nx graph; hosted cloud SaaS timing.

## Repo layout

```text
apps/              future CLIs / services
packages/          shared libs / factory orchestration
docs/              ADRs + agent config
.agents/skills/    agent skills (mattpocock + luchillo17/gh-stack-compact)
```

```bash
pnpm install   # also ensures `gh stack` CLI extension when missing
pnpm nx show projects
# agent skill (project):
npx skills add luchillo17/gh-stack-compact -y
# CLI extension fallback:
gh extension install github/gh-stack
```

No cloud control plane yet.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Issues and PRs welcome — especially around ADW shapes, Sandcastle orchestration patterns, and hard deterministic gates between agent nodes.

## License

[Apache License 2.0](./LICENSE) — see also [NOTICE](./NOTICE) for attribution.
