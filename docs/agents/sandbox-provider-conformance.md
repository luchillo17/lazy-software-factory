# SandboxProvider semantic conformance (Host · Docker · future Vercel)

This note maps the Factory **SandboxProvider** contract to documented Vercel Sandbox
behavior so a future adapter can land without rewriting ADW routing. It is **not**
a runtime validation suite and does **not** add the Vercel SDK or claim that
current CI exercises Vercel.

Related: [ADR-0008](../adr/0008-runtime-docker-cursor-sdk.md),
[ADR-0016](../adr/0016-sandbox-resident-adw-worker.md),
operator [`docs/docker-operator.md`](../docker-operator.md),
issues #81 / #85 / #86.

## Portable contract (Factory-owned)

| Concept                | Factory meaning                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------- |
| Sandbox                | One warm execution environment for **one** ADW                                         |
| Sandbox lease          | Scoped controller handle: capability check, one worker run, release                    |
| ADW worker             | Versioned process inside the Sandbox; speaks the worker protocol                       |
| Hard requirements      | Must be enforced or acquire fails **before** allocation / Agent work                   |
| Soft preferences       | Best-effort; unmet items remain on effective metadata                                  |
| Effective capabilities | What the backend actually provided (caps, isolation, limits, unmet soft)               |
| Capacity               | Configurable allocation ceiling; typed busy/capacity error; **no** provider-side queue |
| Cancellation           | Bounded graceful stop → force-kill → idempotent release of slot + resources            |

Resource limits on the wire: CPU (fractional cores), memory (bytes), PID count,
lifetime (ms). Features that may be hard/soft: `disk_quota`, `retained_workspaces`.

## Host vs Docker (documented differences)

|                       | Host                                        | Docker v1                                               |
| --------------------- | ------------------------------------------- | ------------------------------------------------------- |
| Isolation             | `host`                                      | `container`                                             |
| Max concurrent leases | **1**                                       | Configurable (default 32)                               |
| CPU / memory / PID    | Not enforceable (hard → fail; soft → unmet) | Enforced via `docker create` flags and reported         |
| Lifetime              | Not enforceable                             | Provider-side timer + release                           |
| Disk quota            | Unsupported                                 | Unsupported (unless a future backend truly enforces it) |
| Retained workspaces   | Unsupported                                 | Unsupported (ephemeral volume per lease)                |
| Source intake         | Host cwd / `--cwd`                          | Remote Git only (no dirty-tree bind mounts)             |

Shared conformance suite: `packages/runtime/src/sandbox-provider.conformance.ts`
(Host stub worker + Docker fake CLI). Live Docker concurrency:
`packages/adw/src/docker-integration.spec.ts` (`adw:test-docker`).

**Isolation boundary:** Sandbox isolates **compute and filesystem** only. Shared
external backends (git forges, cloud deployments, SaaS APIs — e.g. [#78](https://github.com/luchillo17/lazy-software-factory/issues/78))
remain shared across concurrent ADWs; the provider does not virtualize them.

## Vercel Sandbox — semantic mapping (no SDK)

Based on public Vercel Sandbox docs (opaque workspace, OCI image, streamed
command execution, stop vs persistence). **Do not** treat this table as proof
that a Vercel adapter exists or is tested.

| Factory concept          | Vercel-oriented mapping                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Opaque workspace         | Firecracker / microVM workspace id — **no host-path guarantee** (same as Docker `/workspace`)                          |
| Runner image             | OCI image reference resolved by the adapter Layer (project/team/region stay Layer config, not ADW request types)       |
| Worker launch / protocol | Streamed command (or equivalent) carrying stdin protocol + stdout frames; secrets only on the launch channel           |
| `runWorker` progress     | Map streamed stdout/stderr lines → typed progress frames; keep protocol stdout machine-only                            |
| Lifetime / stop          | Map Factory `lifetimeMs` + cancel to Vercel stop / timeout APIs                                                        |
| Retained workspaces      | Only claim `supported` when Vercel persistence is actually used and owned; otherwise `unsupported` / `unknown`         |
| Disk quota               | Report honestly from what the product enforces; never invent a quota                                                   |
| Effective limits         | Translate Vercel reported / configured CPU·memory·timeout into `AdwWorkerEffectiveCapabilities.limits`                 |
| Capacity busy            | Adapter-local concurrent ceiling **or** upstream quota → `SandboxBusyError` (caller queues)                            |
| AgentProvider            | Remains orthogonal — Cursor local SDK still runs **inside** the Sandbox worker, not as a Vercel-specific agent wrapper |

## Explicit non-claims

- No Vercel dependency in this repository from this note.
- No CI job validates Vercel runtime behavior.
- Snapshots, hibernation, and retained-failure sandboxes remain out of Docker v1
  and are not implied for Vercel until an adapter implements and reports them.
