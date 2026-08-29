# Sandbox-resident ADW worker and Cursor local runtime

Host Minimal ADW used to run the orchestration graph in the controller process after `SandboxProvider.create`. Docker (and later cloud) adapters cannot keep Cursor SDK local agents, custom tools, and deterministic gates on the controller machine: the SDK caller’s process is where file edits, shell, MCP, and tools actually run. We therefore run one **versioned ADW worker** inside each **Sandbox**, behind a scoped **Sandbox lease**. The public `runMinimalAdw` entry acquires the lease and consumes a typed worker protocol; the Minimal ADW graph is worker-internal. Host stays weakly isolated and single-ADW-at-a-time, but shares the same controller/worker seam Docker uses.

## Status

accepted

## Architecture locks

- **Sandbox-resident ADW worker** — orchestration + Cursor local agents run inside the Sandbox, not on the controller (this ADR).
- **Project-owned Effect provider contract** — `SandboxProvider` / lease / worker protocol are Factory Effect services and Schema types in `packages/runtime` + `packages/adw-worker`. Adapters plug Layers; ADW graph modules do not import Docker- or cloud-specific types.
- **OCI substrate** — classic Docker (and future cloud sandboxes) run a versioned **runner image**; image reference is Layer config (`dockerSandboxProviderLayer({ image })`), never an ADW request field. Local tag from `pnpm adw:runner:build`; no registry publish required for the operator path.
- **Cursor local-runtime constraint** — AgentProvider stays local-in-worker (`Agent.create` / `Agent.resume` against sandbox cwd). Cloud Cursor agents are out of this seam; wrapping only shell/`exec` while keeping SDK on the controller is rejected.
- **Host / Docker parity** — same `runMinimalAdw` controller, worker protocol, WorkspaceProvision rules, and Ship statuses. Differences are provider metadata only (isolation, concurrency, source intake, enforceable limits). See [`docs/agents/sandbox-provider-conformance.md`](../agents/sandbox-provider-conformance.md). Generic `adw` defaults to Docker after [#86](https://github.com/luchillo17/lazy-software-factory/issues/86); `adw-host` / `--sandbox host` remain first-class.

## Consequences

- Controller and worker speak a versioned Effect Schema protocol (request, progress frames, terminal `completed` / `cancelled` / `infrastructure_failed`).
- Cursor local SDK must execute inside the provider environment (the worker), not on a host-side wrapper around container `exec`.
- Portable `Sandbox.exec` requests are structured: command + argv with optional cwd, per-operation environment, stdin, and timeout. Shell strings are not the provider contract.
- SandboxProvider grows `acquire` (lease + capabilities + `runWorker`); in-process `create` remains for worker-local exec and tests.
- Glossary: **Sandbox lease**, **ADW worker** (see `CONTEXT.md`).
- Sandbox isolates compute and filesystem; it does **not** isolate shared external backends (forges, cloud deploys, SaaS — e.g. [#78](https://github.com/luchillo17/lazy-software-factory/issues/78)).

## Considered Options

- **Keep in-process Host graph; wrap only deterministic commands in Docker** — rejected; Cursor local agents would still run on the controller host.
- **Separate Host orchestration path forever** — rejected; serialization and lifecycle bugs would diverge before Docker lands.
- **Cursor cloud agents instead of local-in-sandbox** — rejected for this seam; AgentProvider stays orthogonal and local-in-worker matches ADR-0008.
