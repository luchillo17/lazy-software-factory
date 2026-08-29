# Effect Runtime: classic Docker + Cursor SDK (Sandcastle out of stack)

The Factory Runtime (`packages/runtime`, EffectTS) owns sandbox lifecycle and agent providers. **Local default for generic `adw`:** classic Docker daemon via a thin TypeScript / OCI adapter (one warm sandbox per ticket; runner image is Layer config). **Host sandbox** remains a first-class lightweight provider (`adw --sandbox host`, `adw-host`) for single-ADW local use. **Agent default for Build/resume:** Cursor via `@cursor/sdk` (`Agent.create` / `Agent.resume`) **inside the ADW worker** (ADR-0016) with the warm sandbox as the isolation/pointer context — Docker keeps the box warm; the SDK owns thread continuity.

**Prefer Effect when it fits** (`packages/*`, `apps/*`): services, Layers, Schema, Effect programs as the public shape; wrap foreign async with `Effect.tryPromise` (or equivalent) at the boundary. That includes Runtime, ADW, and Git host. Libraries and Node stdlib are welcome wherever they help — Effect is not a ban on deps. Thin root `scripts/` need not use Effect until they become a product surface.

**Effect version:** pin Effect **4 beta** (`4.0.0-beta.x`, exact versions in package manifests) while the Factory is early alpha. Prefer stable `effect/*` imports; treat `effect/unstable/*` as opt-in. Bump betas deliberately; expect breaking changes until v4 stable (see ADR-0012).

[Sandcastle](https://github.com/mattpocock/sandcastle) is **not** part of our stack (no `@ai-hero/sandcastle` dependency for product paths). It remains prior-art reference for provider/worktree ideas only. Docker Sandboxes (`sbx`) are **not** required (Docker login tax); they may appear later as an optional `SandboxProvider`. Cloud/BYO providers (e.g. Vercel Sandbox on the Organization’s account) plug the same seam so orgs keep control of code and compute.

## Status

accepted

## Considered Options

- **Sandcastle as control plane / required runtime** — rejected; Cursor CLI provider is non-resumable by Sandcastle policy; we need SDK resume and our own ADW.
- **Docker Sandboxes (`sbx`) as the only local path** — rejected for now; mandatory Docker login scares clients; optional later.
- **New sandbox per ADW step** — rejected; see ADR-0007 warm sandbox.
- **Effect only for Runtime/ADW/Git host; Promise elsewhere** — rejected as the standing default; prefer one async/error style across packages and apps when Effect fits.
- **Promise-first public APIs with Effect only inside** — rejected; Layers/services/errors are the seam.
- **Effect-only, no libraries** — rejected; Effect is preference, not a dep ban.
- **Require Effect in root `scripts/`** — rejected for now; thin glue can stay without Effect until it is a product surface.
- **Stay on Effect 3 until v4 stable** — rejected for early alpha; see ADR-0012.
