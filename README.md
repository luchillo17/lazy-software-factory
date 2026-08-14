# lazy-software-factory

Open-source **AI developer workflows** (a software factory) built on:

- **`packages/runtime`** — Effect Runtime: sandbox lifecycle + agent providers (Cursor SDK; classic Docker locally)
- **`packages/adw`** — ADW graph + hard gates (Build → Test agent → Review)
- [mattpocock/skills](https://github.com/mattpocock/skills) — engineering **process** (grill → tickets → TDD → review)
- IndyDevDan-style ADWs — **code owns the gates**; agents own judgment

[Sandcastle](https://github.com/mattpocock/sandcastle) is prior-art **reference only** — not part of this stack.

The goal is a factory you can run locally (WSL + Docker recommended), with orchestration you own in TypeScript — not a single mega-skill that lints, tests, and reviews itself. It should be **self-building**: once the loop exists, use this factory’s ADWs to develop this repo’s apps and packages.

## Status

Early bootstrap. Public so people can contribute while the shape settles.

**Decided (see [docs/adr](./docs/adr/) and [CONTEXT.md](./CONTEXT.md)):** Nx; extractable `adw` + `runtime` (+ git-host seam); self-building; classic Docker + Cursor SDK; Convex + Better Auth direction; logical org tenancy. Sandcastle not in stack. Outside-monorepo consume path (v0, no npm publish): [docs/extractability.md](./docs/extractability.md).

**Still open:** fuller Runtime/ADW implementation; hosted cloud SaaS timing.

## Repo layout

```text
apps/              future CLIs / services
packages/
  adw/             ADW graph + gates
  runtime/         Effect sandbox + agent providers
  git-host/        forge seam (clone/push/PR)
docs/              ADRs + agent config (+ extractability note)
.agents/skills/    agent skills (mattpocock + luchillo17/gh-stack-compact)
```

```bash
cp .env.example .env   # CURSOR_API_KEY + GH_TOKEN for local runs
pnpm install           # also ensures `gh stack` CLI extension when missing
pnpm nx show projects
# agent skill (project):
npx skills add luchillo17/gh-stack-compact -y
# CLI extension fallback:
gh extension install github/gh-stack
```

No cloud control plane yet.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Issues and PRs welcome — especially around ADW shapes, Runtime sandbox providers, and hard deterministic gates between agent nodes.

## License

[Apache License 2.0](./LICENSE) — see also [NOTICE](./NOTICE) for attribution.
