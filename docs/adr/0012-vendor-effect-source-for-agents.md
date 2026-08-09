# Vendor Effect source for coding agents

This repo vendors the Effect TypeScript source under `repos/effect` (git subtree from `Effect-TS/effect`, squashed) so coding agents can learn idiomatic Effect from real implementations, tests, and module layout—not from fragmented docs fetches or compiled `node_modules`. Agents treat that tree as **read-only reference**; application code continues to import `effect` from the package dependency (currently Effect 3.x). Editor search/auto-import excludes `repos/` so humans are not flooded; `@effect/language-service` supplies Effect-aware diagnostics.

## Status

accepted

## Considered Options

- **Docs / web search only** — rejected; agents need patterns and surrounding structure, and docs often lag or omit idiomatic usage (Effect team guidance).
- **Rely on `node_modules/effect`** — rejected; published artifacts are often compiled/flattened, and agents commonly skip gitignored dependency trees.
- **Git submodule** — workable but rejected for day-to-day friction (explicit init on clone, indirection, `.gitmodules`); subtree keeps reference files in-tree.
- **Shared clone only (`~/.local/share/...`)** — fine as a personal shortcut; rejected as the **repo** default so every clone/CI/agent session shares the same pointer without per-machine setup. Effect Solutions’ `effect-smol` path is for Effect v4; we pin **`Effect-TS/effect`** while we depend on Effect 3.x.
- **Import or edit code under `repos/`** — rejected; vendored tree is reference only, not an app source root.
