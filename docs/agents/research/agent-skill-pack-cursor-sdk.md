# Research: Agent Skill pack loading via Cursor SDK

**Ticket:** [#30](https://github.com/luchillo17/lazy-software-factory/issues/30)  
**Branch:** `research/agent-skill-pack-cursor-sdk`  
**Package pin studied:** `@cursor/sdk@1.0.27` (workspace dependency of `@lazy-software-factory/runtime`)  
**Question:** How can a configured Agent load a Skill pack root (default `.agents/skills`) plus Role skill binding into an Agent session — what APIs exist, what must we invent, constraints?

Primary sources only: Cursor docs, `@cursor/sdk` types/README, this repo’s Runtime/AgentProvider + domain ADRs.

---

## Verdict (short)

1. **Skill pack root:** Cursor discovers skills from on-disk roots (project default `.agents/skills/`, also `.cursor/skills/`, user `~` trees, and Claude/Codex compat dirs). The SDK has **no** `skills` / `skillPack` / `loadSkills` field on `AgentOptions`. Local agents pick skills up as part of **workspace resolution** from `local.cwd` / `local.dirs`; optional `prewarmLocalWorkspace` pays that cost early.
2. **Role skill binding:** **Not an SDK API.** Domain intent (orchestration injects mandatory skills per role at bootstrap) must be invented in ADW/prompt policy. Closest SDK-adjacent levers: put `/skill-name` (or equivalent instructions) in `agent.send` text, and/or rely on model auto-application from skill descriptions — neither is a hard bind in public SDK types.
3. **This repo today:** `packages/runtime` Cursor adapter passes `apiKey`, `model`, optional **`agents`** (subagent defs), and `local: { cwd, settingSources: ["project"], dirs?, customTools? }` into `Agent.create` / `Agent.resume`. Role skill binding remains ADW prompt policy (not an SDK skills field). Empty/omitted `agents` + no `.cursor/agents` ⇒ parent may work inline — not an ADW hard spawn guarantee.

---

## Domain intent (this repo)

| Term                    | Meaning (source)                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Skill**               | Agent-facing process guidance; roles are **role-skill-bound**; orchestration injects the mandatory skill set at session bootstrap (e.g. Build → `/implement`). Skills do not own pass/fail routing. ([`CONTEXT.md`](../../../CONTEXT.md)) |
| **Role skill binding**  | ADW/control-plane policy mapping role → skill set; content in skills; binding/injection in orchestration — **avoid** putting skill selection only inside Runtime/`AgentProvider`. ([`CONTEXT.md`](../../../CONTEXT.md))                   |
| **Split**               | Skills / Runtime / ADW stay separate (ADR-0001). ([`docs/adr/0001-skills-runtime-adw-split.md`](../../adr/0001-skills-runtime-adw-split.md))                                                                                              |
| **Canonical pack root** | Canonical skill bodies under `.agents/skills/`; install recipe in [`docs/agents/skills-install.md`](../skills-install.md) / [`AGENTS.md`](../../../AGENTS.md).                                                                            |

---

## What Cursor documents about Skills (not SDK-specific)

From [Agent Skills](https://cursor.com/docs/skills) (fetched):

- Skills are discovered automatically from skill directories and presented to the Agent; the agent decides relevance from context.
- Manual invoke: type `/` in Agent chat and select/search the skill name.
- **Project roots:** `.agents/skills/`, `.cursor/skills/`.
- **User roots:** `~/.agents/skills/`, `~/.cursor/skills/`.
- **Compat:** also `.claude/skills/`, `.codex/skills/`, and their `~` equivalents.
- Layout: each skill is a folder with `SKILL.md` (optional `scripts/`, `references/`, `assets/`).
- Frontmatter includes `name`, `description`, optional `paths`, optional `disable-model-invocation` (when `true`, skill is only included on explicit `/skill-name` invoke — not auto-applied).
- Nested skill dirs and nested project `.agents/skills` / `.cursor/skills` under packages are supported (nested project skills scoped to that subdirectory).

**Implication for “Skill pack root”:** the pack is a **filesystem convention**, not an SDK registration call. Pointing a local agent’s workspace `cwd` (or cloud clone) at a checkout that contains `.agents/skills/` is the documented discovery path.

Plugins are a second distribution path: plugin manifests may declare `skills` paths / default `skills/` discovery ([Plugins reference](https://cursor.com/docs/reference/plugins)). That is package/IDE plugin loading, not an `Agent.create` skills array.

---

## What `@cursor/sdk` exposes (v1.0.27)

Sources: [TypeScript SDK docs](https://cursor.com/docs/sdk/typescript), package `README.md` (points at docs), and `dist/esm/options.d.ts` / `platform.d.ts` in `node_modules/.pnpm/@cursor+sdk@1.0.27/...`.

### `AgentOptions` — no skills field

Public create options include `model`, `apiKey`, `name`, `local`, `cloud`, `mcpServers`, `agents` (**subagents**), `tools`, `disallowedTools`, `agentId`, `idempotencyKey`, `mode` — **not** skills, skill packs, or role bindings (`options.d.ts` `AgentOptions`).

`agents` here means **subagent definitions** (`AgentDefinition`: `description`, `prompt`, optional `model` / `mcpServers`), not Agent Skills folders.

### Local workspace knobs that _do_ mention skills

From `LocalAgentOptions` (`options.d.ts`):

- **`cwd`:** primary working directory (shell + store scoping).
- **`dirs`:** additional workspace folders; merged with `cwd` so “project rules, **skills**, and request-context workspace metadata load from every unique path.”
- **`settingSources`:** ambient Cursor settings layers (`"project" | "user" | "team" | "mdm" | "plugins" | "all"`). Documented primarily for on-disk settings / MCP / related layers under `.cursor/` and user trees — **not** listed as an inline Skills API.

From SDK docs configuration table (“Configuration sources at a glance”): rows for MCP, Subagents, Hooks, Settings sources — **no Skills row with an inline option**. Skills appear elsewhere as part of **workspace scan**.

From SDK docs / `Cursor.configure`:

- `local.workspaceScanCacheTtlMs` — TTL for reusing a workspace scan of “rules, **skills**, `AGENTS.md`, ignore files” (default 20s; also `CURSOR_RIPWALK_CACHE_TTL_MS`).

From SDK docs / `CursorAgentPlatform.prewarmLocalWorkspace` (`platform.d.ts` + docs):

- Resolving a local workspace — “Cursor rules, **skills**, MCP, the ignore mappings” — is the slow part of the first local turn; hosts can prewarm with the same `AgentOptions` agents will use.

**Package README:** `Documentation: https://cursor.com/docs/api/sdk/typescript` only — no extra skill API surface in the README body.

### `settingSources` vs skill pack roots (constraint / uncertainty)

Documented clearly:

- Without `local.settingSources`, **file-based MCP** is not loaded (inline only).
- Cloud ignores `local.settingSources` and always loads `project` / `team` / `plugins`.
- Skills discovery roots include **`.agents/skills/`** (not only `.cursor/`).

**Not documented explicitly:** whether empty `settingSources` suppresses `.agents/skills` discovery. Evidence leans to **skills following workspace path scan (`cwd`/`dirs`)**, while `settingSources` gates ambient `.cursor`/plugin/settings layers (MCP table language: “file-based MCP / subagent paths it gates”). Treat “must pass `settingSources: ['project']` to see `.agents/skills`” as **unproven** from public docs/types; safest product assumption for Host sandboxes: ensure sandbox `cwd` is the repo root that contains `.agents/skills`, and verify with a live local run if gating surprises appear.

### Invocation / binding

- IDE docs: slash invoke `/skill-name`; auto-apply unless `disable-model-invocation: true`.
- SDK `SDKAgent.send` accepts a string or `SDKUserMessage` (`text` + optional images). Public types/docs **do not** document a dedicated “force skill” or “attach skill ids” parameter.
- Therefore **Role skill binding cannot be expressed as SDK config today**; it must be orchestration-owned (prompt text, conventions, maybe later hooks) per [`CONTEXT.md`](../../../CONTEXT.md).

---

## What this repo’s AgentProvider does today

Files: [`packages/runtime/src/agent-provider.ts`](../../../packages/runtime/src/agent-provider.ts), [`cursor-sdk.ts`](../../../packages/runtime/src/cursor-sdk.ts), [`cursor-agent-provider.ts`](../../../packages/runtime/src/cursor-agent-provider.ts).

| Seam               | Behavior                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AgentRunOptions`  | `prompt`, required `sandbox`, optional `model`, `env`, `customTools`, `workspaceDirs`, optional **`agents`** (subagent `AgentDefinition` catalog). No skill-pack / role-binding fields (those stay ADW prompt policy).                                                   |
| `AgentSession`     | Opaque `sessionId` (+ optional `output`) — Cursor adapter maps to SDK agent id.                                                                                                                                                                                          |
| `CursorSdkService` | `Agent.create` / `Agent.resume` only.                                                                                                                                                                                                                                    |
| `createOptions`    | `{ apiKey?, model?, agents?, local: { cwd, settingSources: ["project"], dirs?, customTools? } }`. Inline `agents` override same-named `.cursor/agents/*.md`; omitting `agents` leaves file-based defs usable. No `disallowedTools` on task/agent (spawn stays possible). |
| Live Layers        | `CursorBuildAgentLive` / `CursorReviewAgentLive` / `CursorAgentLive` wire the above.                                                                                                                                                                                     |

**Empty catalog:** if callers pass no `agents` and the workspace has no `.cursor/agents`, the parent agent may keep multi-axis work **inline**. That is expected — Factory enables spawn capability; it does not hard-guarantee dual parallel subagent orchestration from the ADW graph.

ADW ([`packages/adw/src/run-minimal-adw.ts`](../../../packages/adw/src/run-minimal-adw.ts)) calls `buildAgent.run` / Review with role-skill prompt injection where wired — catalog supply from ADW is optional later dogfood.

Tests assert create/resume options include passed `agents` via a fake SDK (`cursor-agent-provider.spec.ts`).

---

## APIs that exist (usable for Skill pack loading)

| Mechanism                                                                 | Exists?            | Role                                                           |
| ------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------- |
| Filesystem pack at `.agents/skills/` (and siblings)                       | Yes (Skills docs)  | Pack root discovery                                            |
| `Agent.create` / `send` / `resume` with `local.cwd` (and optional `dirs`) | Yes (SDK)          | Point session workspace at checkout that contains the pack     |
| `Cursor.configure({ local.workspaceScanCacheTtlMs })`                     | Yes (SDK)          | Cache skill/rules scan freshness                               |
| `createAgentPlatform().prewarmLocalWorkspace(options)`                    | Yes (SDK)          | Eager workspace (incl. skills) resolve for hosts               |
| `local.settingSources`                                                    | Yes (SDK)          | Ambient settings/MCP/plugins layers; **not** a skills pack API |
| Plugin `skills` manifest / plugin install                                 | Yes (Plugins docs) | Alternate bundling; IDE/plugin channel more than Runtime       |
| Inline `AgentOptions.skills` / skill IDs / role map                       | **No**             | —                                                              |
| Hard Role skill binding in SDK                                            | **No**             | —                                                              |

---

## What we must invent

Aligned with ADR-0001 and `CONTEXT.md` (binding in orchestration, not only Runtime):

1. **Role → skill set policy** in ADW (or a small orchestration config module): e.g. Build → `implement` (and any mandatory companions); Review → review skill set.
2. **Injection at session bootstrap / each `send`:** construct prompts that **mandate** the bound skills (e.g. lead with `/implement …` and/or explicit “follow skill X” instructions). SDK will not enforce this; treat agent compliance as soft unless product later adds gates that fail on non-compliance.
3. **Pack presence in the sandbox:** Workspace provision / Host sandbox must leave `.agents/skills` (or documented alternate root) on the agent `cwd`. Cloud clones inherit repo skills if committed.
4. **Optional Runtime helpers (thin):** pass-through for `local.dirs` / `settingSources` / prewarm — still **not** role binding (glossary: avoid skill selection only inside `AgentProvider`).
5. **Verification:** live local SDK run proving `.agents/skills` appears in agent-available skills with current `createOptions`; confirm whether slash text in `send()` triggers the same path as IDE `/` invoke (undocumented for SDK — needs empiric check before relying on it).
6. **`disable-model-invocation` policy:** if mandatory skills set this flag, auto-apply will not help — orchestration **must** explicit-invoke.

---

## Constraints

- Skills are **guidance**, not ADW hard gates (ADR-0001 / glossary).
- Default agent behavior: **model chooses** when to apply skills; not a guaranteed bind.
- No public SDK API to attach a closed skill allowlist to a session.
- Local vs cloud: cloud always loads project/team/plugins settings and ignores `settingSources`; project skills still depend on files present in the cloned workspace.
- Resume: no skill config to re-pass; **re-apply binding via prompt** on each turn if required. (MCP inline servers _do_ need re-pass on resume — different concern.)
- Current adapter + ADW: pack loads ambiently from cwd; Role skill binding is ADW prompt injection (`role-skill-binding.ts`); optional Runtime `agents` pass-through enables subagent spawn without guaranteeing dual-axis orchestration.
- Skills CLI / `.claude` symlinks ([`skills-install.md`](../skills-install.md)) matter for multi-agent authoring; Cursor SDK local agent cares about whatever roots Cursor discovers under the workspace (`.agents/skills` is the canonical project root).

---

## Recommended shape (design pointer, not decided)

```text
ADW role policy  →  prompt scaffold (/skill + task)  →  AgentProvider.run({ prompt, sandbox })
                         ↑
              filesystem `.agents/skills` under sandbox.cwd
              (SDK workspace scan; optional prewarm)
```

Do **not** wait for a non-existent `AgentOptions.skills` field. Invent binding in orchestration; keep Runtime as cwd/session adapter.

---

## Sources

1. [Cursor Agent Skills](https://cursor.com/docs/skills) — discovery roots, `/` invoke, frontmatter, `disable-model-invocation`.
2. [Cursor TypeScript SDK](https://cursor.com/docs/sdk/typescript) — `AgentOptions`, `LocalAgentOptions`, workspace scan TTL, prewarm, `settingSources`, config-sources table.
3. [Cursor Plugins reference](https://cursor.com/docs/reference/plugins) — plugin `skills` component discovery.
4. `@cursor/sdk@1.0.27` — `dist/esm/options.d.ts`, `platform.d.ts`, `README.md`.
5. Repo: `CONTEXT.md`, `docs/adr/0001-skills-runtime-adw-split.md`, `docs/agents/skills-install.md`, `AGENTS.md`, `packages/runtime/src/{agent-provider,cursor-sdk,cursor-agent-provider}.ts`, `packages/adw/src/run-minimal-adw.ts`.
