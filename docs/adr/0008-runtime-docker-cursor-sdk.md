# Effect Runtime: classic Docker + Cursor SDK (Sandcastle out of stack)

The Factory Runtime (`packages/runtime`, EffectTS) owns sandbox lifecycle and agent providers. **Local default:** classic Docker daemon via a thin TypeScript adapter (one warm sandbox per ticket); **Host sandbox** is a valid provider until Docker lands (and for single-ADW local use). **Agent default for Build/resume:** Cursor via `@cursor/sdk` (`Agent.create` / `Agent.resume`) with the warm sandbox as the isolation/pointer context — Docker (when used) keeps the box warm; the SDK owns thread continuity.

**EffectTS is the default TypeScript style** for Factory `packages/*` and `apps/*` unless a real constraint blocks it (e.g. a host API is Promise-only and wrapping at the edge is enough, or a tool has no workable Effect path). Prefer Effect services, Layers, Schema, and Effect programs—not Promise-first public APIs with Effect only “inside.” Foreign async APIs use `Effect.tryPromise` (or equivalent) at the boundary. That includes Runtime, ADW (`runMinimalAdw` and gates), and Git host. **Exception:** root monorepo `scripts/` (and similar one-off Node glue at the repo root) may stay plain TypeScript/Node; that exception does not apply to packages or apps.

[Sandcastle](https://github.com/mattpocock/sandcastle) is **not** part of our stack (no `@ai-hero/sandcastle` dependency for product paths). It remains prior-art reference for provider/worktree ideas only. Docker Sandboxes (`sbx`) are **not** required (Docker login tax); they may appear later as an optional `SandboxProvider`. Cloud/BYO providers (e.g. Vercel Sandbox on the Organization’s account) plug the same seam so orgs keep control of code and compute.

## Status

accepted

## Considered Options

- **Sandcastle as control plane / required runtime** — rejected; Cursor CLI provider is non-resumable by Sandcastle policy; we need SDK resume and our own ADW.
- **Docker Sandboxes (`sbx`) as the only local path** — rejected for now; mandatory Docker login scares clients; optional later.
- **New sandbox per ADW step** — rejected; see ADR-0007 warm sandbox.
- **Effect only for Runtime/ADW/Git host; Promise elsewhere** — rejected as the standing default; one async/error style across extractable packages and apps unless something concrete forces an exception.
- **Promise-first public APIs with Effect only inside** — rejected; Layers/services/errors are the seam.
- **Effect including root `scripts/`** — rejected for now; husky/ensure helpers and thin CLI glue stay cheaper as plain Node until a script itself becomes a product surface.
- **Require Effect with no escape hatch** — rejected; real interop and tooling limits may force a local exception, documented at the call site or in a follow-up ADR if systemic.
