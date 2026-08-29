# Docker Minimal ADW operator

Run one **Minimal ADW** through classic Docker: remote Git intake → WorkspaceProvision → Build/Review (Cursor local in-worker) → gates → Ship → `shipped` with a PR URL. Generic `adw` **defaults** to Docker after the live proof ([#86](https://github.com/luchillo17/lazy-software-factory/issues/86)).

Glossary: [`CONTEXT.md`](../CONTEXT.md). Cut: [`VISION.md`](./VISION.md) §5. Worker decision: [ADR-0016](./adr/0016-sandbox-resident-adw-worker.md). Runtime: [ADR-0008](./adr/0008-runtime-docker-cursor-sdk.md). Credentials: [ADR-0003](./adr/0003-runtime-credentials-per-run.md). Provider map: [`docs/agents/sandbox-provider-conformance.md`](./agents/sandbox-provider-conformance.md). Host path: [`docs/host-self-build.md`](./host-self-build.md).

## Prerequisites

- Docker Engine on the operator machine (`docker` on `PATH`; daemon reachable)
- Node `>=22.18` + `pnpm install` at this Factory root (controller + image build)
- Operator-machine credentials in shell or Factory checkout `.env`: **`CURSOR_API_KEY`**, **`GH_TOKEN`** (Issues, Contents, Pull requests). Shell wins over dotenv. Secrets ride **worker stdin** only — never image layers or `docker create -e`
- Git identity in shell or `.env`: `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`. Fresh container clones do not inherit host Git config
- `gh` on `PATH` for TicketIntake on the operator host (Ship/`gh` inside the worker use the injected `GH_TOKEN`)
- An **open** `ready-for-agent` Issue on the **target** remote (or `--ticket` / `--prompt`)
- Local runner image built once (below)

## Image build

```bash
pnpm adw:runner:build
```

Produces local tag `lazy-software-factory/adw-worker:local` (pinned Node digest + staged worker). Override at run time with `ADW_RUNNER_IMAGE` (custom images must still pass the worker handshake). **No registry publish** in this path.

## Provider selection

| Command                           | Provider             | When                                              |
| --------------------------------- | -------------------- | ------------------------------------------------- |
| `adw` / `pnpm adw -- …`           | **Docker** (default) | Isolated concurrent ADWs; remote Git only         |
| `adw --sandbox host …`            | Host                 | Explicit lightweight path on the operator machine |
| `adw-host` / `pnpm adw:host -- …` | Host                 | Same Host path; Factory bin aims invoker/`--cwd`  |

Selection is composition-root only (`packages/adw` operator CLI → Host or Docker Layers). ADW graph code does not import Docker types.

## Remote source and starting reference

Docker **rejects** `--cwd` / `ADW_CWD` (no dirty-tree bind mounts).

```bash
pnpm adw -- --issue <n> --repo-url <git-url> [--starting-ref <ref>]
# equivalent without naming the provider:
pnpm adw -- --issue <n> --repo-url <git-url>
# still valid:
pnpm adw -- --sandbox docker --issue <n> --repo-url <git-url>
```

- **`--repo-url` / `ADW_REPO_URL`** — required. Worker clones into the opaque workspace (`/workspace`).
- **`--starting-ref`** — optional branch or commit after clone; omit to use the remote default tip.
- TicketIntake still runs on the **operator** host (`--issue`); the sandbox never sees operator cwd.

## Credentials

Pass through operator `.env` / shell. Docker keeps a **whitelist** into the worker (`CURSOR_API_KEY`, `GH_TOKEN`, optional `ADW_MODEL` / `CURSOR_MODEL`, `GH_HOST`, git author/committer). Host paths and unrelated secrets are stripped. Do not bake keys into the image.

## Resource requests, cancellation, cleanup

- **Limits** (CPU fractional cores, memory bytes, PID count, lifetime ms) are SandboxProvider concerns on the Docker Layer / acquire path — enforced via `docker create` where supported; reported on effective capabilities. Generic CLI currently requests no explicit limits and exposes no resource flags; embedding consumers configure `defaultLimits` on `dockerSandboxProviderLayer`. Soft prefs the backend cannot meet stay visible as unmet. Host cannot enforce these (hard → fail).
- **Capacity** — configurable concurrent leases (default 32). Exhaustion → typed busy/capacity error; **no** provider-side queue.
- **Cancel** — interrupt the controller Effect: graceful stop → force-kill → idempotent release of container, volume, and capacity slot.
- **Cleanup** — after terminal exit, worker container and workspace volume are removed. Verify:

```bash
docker ps --all --quiet --filter label=lazy.software.factory.adw=1
docker volume ls --quiet --filter label=lazy.software.factory.adw=1
```

Both should print no IDs after a normal or cancelled run.

## Isolation limit (shared backends)

Sandbox isolates **compute and filesystem** (container + ephemeral volume). It does **not** isolate shared external backends the product already talks to (forges, cloud deploys, SaaS APIs — e.g. the deployments discussed in [#78](https://github.com/luchillo17/lazy-software-factory/issues/78)). Concurrent ADWs can still collide on those shared systems.

## Common failures

| Symptom                              | Likely cause                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `Docker sandbox requires --repo-url` | Omitted remote URL (now required by default `adw`)                            |
| `Docker sandbox rejects --cwd`       | Passed Host aiming flags; use Host (`--sandbox host` / `adw-host`) instead    |
| Image / handshake failure            | Rebuild (`pnpm adw:runner:build`) or fix `ADW_RUNNER_IMAGE`                   |
| Daemon errors                        | Docker not running or wrong context                                           |
| Capacity / busy                      | Too many concurrent leases; wait or raise Layer config (caller queues)        |
| `ready_for_pr` (exit 2)              | Review passed; commit/push/open-PR did not (ADR-0011)                         |
| Provision / install fail             | Bad lockfile, unsupported package manager, or clone/auth failure before Build |

## Terminal evidence line

On exit, generic Docker `adw` prints one stdout line (`formatDockerOperatorResult`). Use it as operator evidence. Field order is stable; optional keys are **omitted** when unset (not printed as empty).

Example shape (values illustrative):

```text
status=shipped ticket=93 pr=https://github.com/example/repo/pull/94 sandbox=<lease-uuid> buildSession=<id> reviewSession=<id> terminal=completed image=lazy-software-factory/adw-worker:local capabilities={"capabilities":["cursor_local_agent",…],"maxConcurrentLeases":32,"isolation":"container","retainedWorkspaces":"unsupported","diskQuota":"unsupported"}
```

| Field           | Meaning                                                                                                                                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`        | Minimal ADW outcome: `shipped`, `ready_for_pr`, `failed`, or `not_implemented`.                                                                                                                                                                                                                                           |
| `ticket`        | Ticket / run id (`--ticket`, `--issue`, or intake).                                                                                                                                                                                                                                                                       |
| `pr`            | Opened PR URL when Ship succeeded. **Omitted** when there is no PR (failures, cancel, `ready_for_pr` without a URL, early infra fail).                                                                                                                                                                                    |
| `detail`        | Short human reason when present (cancel / infrastructure / graph fail). Secrets in this text are redacted before print. **Omitted** when unused.                                                                                                                                                                          |
| `sandbox`       | **Authoritative outer Docker Sandbox lease ID** (controller `SandboxLease.id`, typically a UUID). **Not** the worker-local `SandboxProvider.Local` id (`local`). The worker may report `local` on the wire; the controller overwrites with the lease id before formatting. **Omitted** if acquire never produced a lease. |
| `buildSession`  | Opaque Build agent session id when Build ran. **Omitted** if the run never created a Build session.                                                                                                                                                                                                                       |
| `reviewSession` | Opaque Review agent session id for the last Review attempt that ran. **Omitted** if Review never started.                                                                                                                                                                                                                 |
| `terminal`      | Worker/controller terminal kind: `completed`, `cancelled`, or `infrastructure_failed`.                                                                                                                                                                                                                                    |
| `image`         | Effective runner image tag (`ADW_RUNNER_IMAGE` or the default local tag).                                                                                                                                                                                                                                                 |
| `capabilities`  | JSON of lease `effectiveCapabilities`, or the literal `unavailable` when no lease capabilities exist (e.g. acquire failed before a lease).                                                                                                                                                                                |

### `capabilities` JSON

Present keys describe what the Docker Layer actually advertised for that lease:

| Key                                                               | Meaning                                                                                                                     |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `capabilities` (array inside the JSON)                            | Enforced capability strings (e.g. `cursor_local_agent`, `git_host_cli`, `workspace_exec`, `skill_pack_mount`).              |
| `maxConcurrentLeases`                                             | Capacity ceiling for concurrent Docker leases.                                                                              |
| `isolation`                                                       | `container` for Docker.                                                                                                     |
| `retainedWorkspaces` / `diskQuota`                                | Support level (`supported` / `unsupported` / `unknown`) when reported.                                                      |
| `limits`                                                          | Resource limits **actually applied** (`cpu`, `memoryBytes`, `pidsLimit`, `lifetimeMs`). **Omitted** when none were applied. |
| `unmetSoftCapabilities` / `unmetSoftFeatures` / `unmetSoftLimits` | Soft preferences the backend could not meet. **Omitted** when empty.                                                        |

Live generic-CLI runs usually omit `limits` and unmet-limit arrays — same honesty as [Resource requests, cancellation, cleanup](#resource-requests-cancellation-cleanup) (CLI requests no limits; absence means none requested/applied, not a redaction).

### Secrets and recording

- Credentials (`CURSOR_API_KEY`, `GH_TOKEN`, git auth, Bearer tokens, URL userinfo, etc.) **must not** appear in recorded evidence, issue comments, or pasted logs.
- The operator line redacts common secret shapes in `detail` only; `capabilities=` is not secret-scrubbed. Treat redaction as defense in depth, not permission to paste secrets elsewhere.
- Do not paste secret-bearing diagnostics (full `.env`, `docker inspect` env, handshake/request stdin, raw worker frames with `env`). Record status, ticket/PR, lease id, session ids, terminal kind, image, and the capabilities JSON from the line only.

## Proven live + automated evidence

- **Automated concurrency / cancel / leak:** [#85](https://github.com/luchillo17/lazy-software-factory/issues/85) / [PR #92](https://github.com/luchillo17/lazy-software-factory/pull/92) — `packages/adw/src/docker-integration.spec.ts` (`pnpm nx run @lazy-software-factory/adw:test-docker`)
- **Live self-build:** proof ticket [#93](https://github.com/luchillo17/lazy-software-factory/issues/93) → shipped [PR #94](https://github.com/luchillo17/lazy-software-factory/pull/94); default flip [#86](https://github.com/luchillo17/lazy-software-factory/issues/86). Recorded fields match the map above (`terminal=completed`, `status=shipped`, Build/Review session IDs, outer lease `sandbox`, effective container capabilities, no requested/effective resource limits) plus empty post-exit container/volume queries. Full redacted values live on #86.

## Explicit non-goals

No image registry publishing, hosted control plane, Vercel adapter implementation, retained Docker workspaces, or provider-side queue in this operator path.
