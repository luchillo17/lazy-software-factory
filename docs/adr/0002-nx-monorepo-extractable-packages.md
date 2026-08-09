# Nx monorepo with extractable packages

We use **Nx from the start** as the monorepo tool, and we design for **extractable packages** — consumers may run the whole product (local, on-prem, or later hosted) or depend on individual libraries. Thin apps compose packages; tenancy, billing, and hosted control-plane concerns stay at app/cloud edges so core OSS libs stay usable alone. Apache-2.0 on the core leaves room for proprietary hosted layers later.

First packages: **`packages/runtime`** (Effect sandbox + agent providers) and **`packages/adw`** (ADW graph + gates). More apps/packages land as the graph grows.

## Status

accepted

## Considered Options

- **pnpm workspaces first, Nx later** — less bootstrap cost; rejected because we already know we want a multi-package product and prefer one tool for boundaries, generators, and CI from the outset.
- **Single app / no publishable seams** — rejected; on-prem and “use one library” paths matter.
