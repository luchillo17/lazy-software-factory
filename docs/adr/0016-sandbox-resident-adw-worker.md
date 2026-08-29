# Sandbox-resident ADW worker and Cursor local runtime

Host Minimal ADW used to run the orchestration graph in the controller process after `SandboxProvider.create`. Docker (and later cloud) adapters cannot keep Cursor SDK local agents, custom tools, and deterministic gates on the controller machine: the SDK caller’s process is where file edits, shell, MCP, and tools actually run. We therefore run one **versioned ADW worker** inside each **Sandbox**, behind a scoped **Sandbox lease**. The public `runMinimalAdw` entry acquires the lease and consumes a typed worker protocol; the Minimal ADW graph is worker-internal. Host stays weakly isolated and single-ADW-at-a-time, but shares the same controller/worker seam Docker will use.

## Status

accepted

## Consequences

- Controller and worker speak a versioned Effect Schema protocol (request, progress frames, terminal `completed` / `cancelled` / `infrastructure_failed`).
- Cursor local SDK must execute inside the provider environment (the worker), not on a host-side wrapper around container `exec`.
- SandboxProvider grows `acquire` (lease + capabilities + `runWorker`); in-process `create` remains for worker-local exec and tests.
- Glossary: **Sandbox lease**, **ADW worker** (see `CONTEXT.md`).

## Considered Options

- **Keep in-process Host graph; wrap only deterministic commands in Docker** — rejected; Cursor local agents would still run on the controller host.
- **Separate Host orchestration path forever** — rejected; serialization and lifecycle bugs would diverge before Docker lands.
- **Cursor cloud agents instead of local-in-sandbox** — rejected for this seam; AgentProvider stays orthogonal and local-in-worker matches ADR-0008.
