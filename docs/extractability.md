# Extractability note (v0)

How to depend on the extractable Factory packages from **outside** this monorepo’s own apps.

Glossary: [`CONTEXT.md`](../CONTEXT.md). Cut: [`VISION.md`](./VISION.md) §3. Decision: [ADR-0002](./adr/0002-nx-monorepo-extractable-packages.md). Split: [ADR-0001](./adr/0001-skills-runtime-adw-split.md).

## Packages

| Package                           | Path                |
| --------------------------------- | ------------------- |
| `@lazy-software-factory/runtime`  | `packages/runtime`  |
| `@lazy-software-factory/adw`      | `packages/adw`      |
| `@lazy-software-factory/git-host` | `packages/git-host` |

Roles match the glossary: **Runtime**, **ADW**, **Git host** in [`CONTEXT.md`](../CONTEXT.md). Thin apps compose these libraries; skills stay outside the control plane (ADR-0001). Tenancy, billing, and hosted control-plane concerns stay at app/cloud edges (ADR-0002).

## v0 posture: rough DX OK, no npm publish

For **v0**, extractability means consumers can wire these libraries without waiting on a polished registry release. **npm publish is not required.** Expect rough DX: TypeScript source exports, `private: true`, and `workspace:*` links among the three packages.

## Depending from outside monorepo apps

Practical options (pick one):

1. **Sibling checkout** — clone this repo next to your app; depend with `file:` (or pnpm `link:`) on `packages/runtime`, `packages/adw`, and `packages/git-host` as needed.
2. **Git `path:` deps** — point package manager git/subdirectory installs at those package roots (same idea as `file:`, remote instead of local).
3. **Vendor / submodule** — copy or submodule the package trees into your workspace and resolve them like any other local libraries.

Because `adw` depends on `runtime` and `git-host` via `workspace:*`, outside consumers usually need **all three packages resolvable together** (plus their npm peers such as `effect`). Do not expect a single-package install from the registry yet.

Package entrypoints today export TypeScript source (`exports["."] → ./src/index.ts`). Consumers need a runner/toolchain that can load that (this repo uses Node ≥ 22.18 with type stripping / `tsx` — see root `package.json` `engines`).

## Wiring Layers (minimal sketch)

Provide **Runtime** + **Git host** Effect Layers, then run the ADW graph.

Reference Host Minimal ADW composition: `@lazy-software-factory/adw` (`hostMinimalAdwLayer` / `runHostMinimalAdw` in `host-operator.ts`). Outside this repo’s thin Host script:

- Import `runMinimalAdw` (or the Host helper) from `@lazy-software-factory/adw`.
- `Effect.provide` a Layer merge that supplies `SandboxProvider`, Build/Review `AgentProvider`s, and `GitHost` (plus caps/progress sinks as needed).
- Pass credentials per run (`CURSOR_API_KEY`, `GH_TOKEN`, …) — not baked into package code (ADR-0003).
