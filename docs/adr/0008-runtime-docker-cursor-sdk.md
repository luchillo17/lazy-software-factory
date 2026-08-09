# Effect Runtime: classic Docker + Cursor SDK (Sandcastle out of stack)

The Factory Runtime (`packages/runtime`, EffectTS) owns sandbox lifecycle and agent providers. **Local default:** classic Docker daemon via a thin TypeScript adapter (one warm sandbox per ticket). **Agent default for Build/resume:** Cursor via `@cursor/sdk` (`Agent.create` / `Agent.resume`) inside that sandbox — Docker keeps the box warm; the SDK owns thread continuity.

[Sandcastle](https://github.com/mattpocock/sandcastle) is **not** part of our stack (no `@ai-hero/sandcastle` dependency for product paths). It remains prior-art reference for provider/worktree ideas only. Docker Sandboxes (`sbx`) are **not** required (Docker login tax); they may appear later as an optional `SandboxProvider`. Cloud/BYO providers (e.g. Vercel Sandbox on the Organization’s account) plug the same seam so orgs keep control of code and compute.

## Status

accepted

## Considered Options

- **Sandcastle as control plane / required runtime** — rejected; Cursor CLI provider is non-resumable by Sandcastle policy; we need SDK resume and our own ADW.
- **Docker Sandboxes (`sbx`) as the only local path** — rejected for now; mandatory Docker login scares clients; optional later.
- **New sandbox per ADW step** — rejected; see ADR-0007 warm sandbox.
