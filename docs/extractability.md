# Extractability note (v0)

How to depend on the extractable Factory packages from **outside** this monorepo’s own apps — invoke **Host** against a foreign git tree, or compose a **SandboxProvider** for the generic controller — without npm publish.

Glossary: [`CONTEXT.md`](../CONTEXT.md). Cut: [`VISION.md`](./VISION.md) §3 · §4 · §5. Decision: [ADR-0002](./adr/0002-nx-monorepo-extractable-packages.md). Split: [ADR-0001](./adr/0001-skills-runtime-adw-split.md). Host foreign cwd: [ADR-0015](./adr/0015-host-foreign-cwd-before-docker.md). Worker: [ADR-0016](./adr/0016-sandbox-resident-adw-worker.md). Operator: [`docs/host-self-build.md`](./host-self-build.md), [`docs/docker-operator.md`](./docker-operator.md).

## Packages

| Package                             | Path                  |
| ----------------------------------- | --------------------- |
| `@lazy-software-factory/runtime`    | `packages/runtime`    |
| `@lazy-software-factory/adw`        | `packages/adw`        |
| `@lazy-software-factory/adw-worker` | `packages/adw-worker` |
| `@lazy-software-factory/git-host`   | `packages/git-host`   |

Roles match the glossary: **Runtime**, **ADW**, **ADW worker**, and **Git host** in [`CONTEXT.md`](../CONTEXT.md). Thin apps compose these libraries; skills stay outside the control plane (ADR-0001). Tenancy, billing, and hosted control-plane concerns stay at app/cloud edges (ADR-0002).

## v0 posture: rough DX OK, no npm publish

For **v0**, extractability means consumers can wire these libraries without waiting on a polished registry release. **npm publish is not required.** Expect rough DX: TypeScript source exports, `private: true`, and `workspace:*` links among the four packages.

Host-on-foreign-cwd is the same posture: a **bin on the Factory checkout** (`adw-host`), not a registry CLI package.

## Depending from outside monorepo apps

Practical options (pick one):

1. **Sibling checkout** — clone this repo next to your app; depend with `file:` (or pnpm `link:`) on `packages/runtime`, `packages/adw-worker`, `packages/adw`, and `packages/git-host` as needed.
2. **Git `path:` deps** — point package manager git/subdirectory installs at those package roots (same idea as `file:`, remote instead of local).
3. **Vendor / submodule** — copy or submodule the package trees into your workspace and resolve them like any other local libraries.

Because `adw` depends on `adw-worker`, `runtime`, and `git-host` via `workspace:*` (and Runtime also depends on `adw-worker`), outside consumers usually need **all four packages resolvable together** (plus their npm peers such as `effect`). Do not expect a single-package install from the registry yet.

Package entrypoints today export TypeScript source (`exports["."] → ./src/index.ts`). Consumers need a runner/toolchain that can load that (this repo uses Node ≥ 22.18 with type stripping / `tsx` — see root `package.json` `engines`).

## Invoking Host on a foreign cwd

To run Host **Minimal ADW** against another git tree (still no npm publish):

1. Keep a Factory checkout with `pnpm install` (Host resolves `tsx` / workspace packages from there).
2. Put credentials in the **target** tree’s `.env` (or the shell): `CURSOR_API_KEY`, `GH_TOKEN`.
3. Ensure the target cwd has a Skill pack for Build (`.agents/skills` including `/implement`). Review’s `/adw-review` is Host-bundled.
4. Start Host with either:
   - **`adw-host`** from the target repo (omitted `--cwd` → invoker directory), or
   - **`pnpm adw:host -- … --cwd <dir>`** / **`pnpm adw -- --sandbox host …`** from the Factory clone.

```bash
# from the product repo
/path/to/lazy-software-factory/bin/adw-host.mjs --issue 123

# from the Factory clone
pnpm adw:host -- --issue 123 --cwd ../my-product
pnpm adw -- --sandbox host --issue 123 --cwd ../my-product
```

**Footgun:** `--repo-url` does **not** replace an existing `.git` in the sandbox cwd (ADR-0010 reuse). Do not pass `--repo-url` from a Factory checkout to “aim” at another product — use `--cwd` or run `adw-host` from that product. Details: [`docs/host-self-build.md`](./host-self-build.md).

Library callers: `runMinimalAdw` / Host helpers accept an optional `cwd` (default `process.cwd()`) so a thin app can aim the worker without `chdir`.

## Wiring Layers (minimal sketch)

Provide a `SandboxProvider` Effect Layer, then run the public ADW controller.

Reference Host Minimal ADW composition: `@lazy-software-factory/adw` (`hostMinimalAdwLayer` / `runHostMinimalAdw` in `host-operator.ts`). Outside this repo’s thin Host script:

- Import `runMinimalAdw` (or the Host helper) from `@lazy-software-factory/adw`.
- `Effect.provide` a Host, Docker, or future cloud `SandboxProvider` Layer. The selected worker image/process owns Build/Review `AgentProvider`, `GitHost`, gates, and workflow policy.
- Pass credentials per run (`CURSOR_API_KEY`, `GH_TOKEN`, …) so the provider can deliver them through the worker operation, never package code or image layers (ADR-0003).
- Pass `cwd` only for Host. Docker and future opaque-workspace providers use remote source intake.
- In-process `runMinimalAdwGraph` is worker-internal and intentionally absent from the package root export; same-package tests import its internal module directly.

## Compose SandboxProvider without Docker types in ADW graph code

The generic controller (`runMinimalAdw`) depends only on the **project-owned** `SandboxProvider` Effect service (`@lazy-software-factory/runtime`). Provider choice is a **composition-root** concern — keep Docker/OCI types out of Minimal ADW graph modules (`run-minimal-adw`, provision, agents, gates):

1. Import `runMinimalAdw` from `@lazy-software-factory/adw` in your thin app or operator.
2. At that edge only, `Effect.provide` either:
   - `SandboxProvider.host({ … })` / Host Layer helpers, or
   - `dockerSandboxProviderLayer({ image })` / `makeDockerSandboxProviderLayer` from **`@lazy-software-factory/runtime`** (OCI image ref stays Layer config).
3. Factory reference: `operator-cli.ts` is the composition root that selects Host vs Docker Layers; `adw-host` always provides Host. Graph/worker protocol packages stay provider-agnostic.

Consumers adding a cloud adapter implement the same `SandboxProvider` contract and provide their Layer at the edge. See [ADR-0016](./adr/0016-sandbox-resident-adw-worker.md) and [`docs/agents/sandbox-provider-conformance.md`](./agents/sandbox-provider-conformance.md).
