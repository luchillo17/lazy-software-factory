# Contributing

Thanks for helping shape **lazy-software-factory**.

## Principles

1. **Agents propose, code disposes** — agents **can** run lint, format, typecheck, and tests while building if that helps them (e.g. TDD / `/implement`). We don't prescribe how agents work. What matters is **pass/fail routing**: orchestration still runs those checks as hard gates after (or between) agent steps — green advances, red routes back. Code decides whether the workflow may continue.
2. **Skills = behavior, Runtime = isolation/agents, ADW = routing** — process lives in skills/prompts; sandbox + agent providers live in `packages/runtime`; pass/fail graphs live in `packages/adw`. Sandcastle is not in our stack (prior art only).
3. **Keep the control plane thin and inspectable** — prefer small TypeScript workflows over one opaque agent session.
4. **Defer product lock-in** — Nx + extractable packages are decided (ADR-0002); don't assume a hosted cloud product until there's a clear need.
5. **Self-building** — after bootstrap, prefer changing this repo through the factory’s own ADWs (ADR-0006, ADR-0007).

## How to help

- Open an issue for ADW designs, gate designs, or Runtime provider ideas before large PRs.
- Prefer vertical slices with tests over broad scaffolding.
- Use clear PR descriptions: problem → approach → how to verify.

## Local setup (recommended)

- **WSL2 (Ubuntu)** + Git + `gh`
- **Node.js ≥ 22.18** (native type stripping; see `engines` in root `package.json`)
- **pnpm** (see `packageManager` in root `package.json`) + **Nx**
- **Docker** (classic daemon for local warm sandboxes — ADR-0008)

TypeScript is **erasable-syntax only** (`erasableSyntaxOnly` in `tsconfig.json`) so scripts run with `node *.ts`. `pnpm install` runs `postinstall` → installs the `github/gh-stack` gh extension when missing (skips cleanly if already present or `gh` is absent). Enable stacked PRs on the GitHub repo if `gh stack` exits 9.

```bash
cp .env.example .env
# fill CURSOR_API_KEY + GH_TOKEN (Issues/Contents/PRs — see .env.example)
pnpm install
pnpm typecheck
pnpm nx show projects
# optional re-check:
pnpm ensure:gh-stack
```

Language and ADRs: [CONTEXT.md](./CONTEXT.md), [docs/adr](./docs/adr/). Compact `gh stack` agent skill: [`luchillo17/gh-stack-compact`](https://github.com/luchillo17/gh-stack-compact) (`npx skills add luchillo17/gh-stack-compact`).

## Code of conduct

Be respectful. Assume good intent. Disagreement is fine; dismissiveness isn't.
