# Research: Build Agent transitive skill closure

**Ticket:** [#31 — Research Build Agent transitive skill closure](https://github.com/luchillo17/lazy-software-factory/issues/31)  
**Map:** [#26 — Factory vision + v0 cut](https://github.com/luchillo17/lazy-software-factory/issues/26)  
**Primary sources:** `.agents/skills/**/SKILL.md` (and companion files under those skill dirs). Symlinks under `.claude/skills/` point at the same tree; no extra skills there.  
**Method:** Start from bound seeds `/implement` + hard `/tdd`. Follow every in-tree skill reference (`/name`, `` `name` skill ``, “use the `/name` skill”). Do not invent skills absent from `.agents/skills/`. Stop when a skill’s files name no further skills.

## Question

From this Factory’s `.agents/skills`, what is the transitive skill closure for a Build Agent bound to `/implement` + hard `/tdd`, including skills those files reference? Produce an explicit allowlist candidates table with sources.

## Graph (walk order)

```
implement  (seed / bound)
├── tdd              (seed / hard-bound; also named by implement)
│   ├── codebase-design
│   └── code-review  (also named by implement)
└── code-review
    └── setup-matt-pocock-skills  (conditional: only if docs/agents/issue-tracker.md missing)
```

No further skill edges from `codebase-design` or `setup-matt-pocock-skills` that instruct the Build Agent to _run_ another skill.

## Allowlist candidates

| Skill                      | Role in closure                           | Why included                                                                                                                             | Citation                                                                                  |
| -------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `implement`                | Seed (bound)                              | Map/ticket bind Build Agent to `/implement`                                                                                              | Issue #31 body; map #26 Notes (“Default Build Agent skills: `/implement` + hard `/tdd`…”) |
| `tdd`                      | Seed (hard-bound) + edge from `implement` | Hard bind; `implement` says “Use `/tdd` where possible…”                                                                                 | `.agents/skills/implement/SKILL.md` L9; issue #31 / map #26                               |
| `code-review`              | Transitive                                | `implement`: “Once done, use `/code-review`…”. `tdd`: refactoring “belongs to the review stage (see the `code-review` skill)”            | `.agents/skills/implement/SKILL.md` L13; `.agents/skills/tdd/SKILL.md` L38                |
| `codebase-design`          | Transitive                                | `tdd`: when interface/seam shape is in question, “use the `/codebase-design` skill for the vocabulary” (consult, not a separate session) | `.agents/skills/tdd/SKILL.md` L26                                                         |
| `setup-matt-pocock-skills` | Transitive (conditional)                  | `code-review`: “run `/setup-matt-pocock-skills` if `docs/agents/issue-tracker.md` is missing”                                            | `.agents/skills/code-review/SKILL.md` L13                                                 |

### Sorted allowlist (skill names only)

`code-review`, `codebase-design`, `implement`, `setup-matt-pocock-skills`, `tdd`

## Edge detail (verbatim anchors)

### `implement` → `tdd`, `code-review`

Source: `.agents/skills/implement/SKILL.md`

- L9: `Use /tdd where possible, at pre-agreed seams.`
- L13: `Once done, use /code-review to review the work.`

No other skill names in that file. (`disable-model-invocation: true` on the skill YAML — binding/orchestration concern, not a graph edge.)

### `tdd` → `codebase-design`, `code-review`

Source: `.agents/skills/tdd/SKILL.md`

- L26: `use the `/codebase-design` skill for the vocabulary`
- L38: `see the `code-review` skill`

Companion files `.agents/skills/tdd/tests.md` and `.agents/skills/tdd/mocking.md` name no skills (only local path examples like `/users/...`).

### `code-review` → `setup-matt-pocock-skills`

Source: `.agents/skills/code-review/SKILL.md`

- L13: `run `/setup-matt-pocock-skills`if`docs/agents/issue-tracker.md` is missing.`

Other references are docs/workflows (`docs/agents/issue-tracker.md`, git), not skills.

**Factory note:** `docs/agents/issue-tracker.md` already exists in this repo, so the conditional edge is dormant at runtime here — still part of the reference closure for an allowlist that must cover a cold clone / missing setup.

### `codebase-design` — terminal

Source: `.agents/skills/codebase-design/SKILL.md`

- Points only at companion docs `DEEPENING.md` and `DESIGN-IT-TWICE.md` (same skill folder). Those companions do not name other skills to run.

### `setup-matt-pocock-skills` — no Build-Agent use edges

Source: `.agents/skills/setup-matt-pocock-skills/SKILL.md`

- Mentions `triage` only as an _install existence check_ (“Is the `triage` skill installed?”) to decide whether to write triage-label docs — not an instruction for Build to run `/triage`.
- Narrative mentions of `to-tickets`, `triage`, `to-spec` as consumers of the written config — not Build invocation edges.
- Seed template `.agents/skills/setup-matt-pocock-skills/domain.md` names `/domain-modeling`, `/grill-with-docs`, `/improve-codebase-architecture` as documentation about _other_ engineering skills creating CONTEXT/ADRs. That is template prose for setup output, not a “Build Agent must run X” edge from the closure walk. **Excluded from allowlist.**

## Explicit non-members (checked, out of closure)

These live under `.agents/skills/` but are **not** reached by use/consult references from the seed pair:

- Orchestration / other agents: `wayfinder`, `triage`, `research`, `prototype`, `grilling`, `grill-me`, `grill-with-docs`, `domain-modeling`, `improve-codebase-architecture`, `to-spec`, `to-tickets`, `to-questionnaire`, …
- Review-shaped alternatives called out on map #26 as _not_ Build defaults: Bugbot-only Review in v0; no always-on `/improve-codebase-architecture`.
- Nx / tooling skills (`nx-*`, `monitor-ci`, `link-workspace-packages`, …): not named by `implement` / `tdd` / their transitive SKILL.md files.
- Caveman / cavecrew family: not named by this graph.
- Vendored `repos/effect/.agents/skills/*`: outside Factory pack root; ignored.

## Non-skill artifacts the closure reads (not allowlist entries)

| Artifact                                                                     | Reached from                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `CONTEXT.md`, ADRs under `docs/adr/` (and per-context ADRs if multi-context) | `tdd` (domain language); also assumed by setup’s domain consumer rules |
| `.agents/skills/tdd/tests.md`, `mocking.md`                                  | `tdd`                                                                  |
| `.agents/skills/codebase-design/DEEPENING.md`, `DESIGN-IT-TWICE.md`          | `codebase-design`                                                      |
| `docs/agents/issue-tracker.md` (and related `docs/agents/*.md` after setup)  | `code-review`                                                          |
| Repo standards docs (e.g. `CODING_STANDARDS.md`, `CONTRIBUTING.md`)          | `code-review` Standards axis                                           |

## Verdict for Agent Skill pack binding

**Recommended Build Agent allowlist candidates (5):**

1. `implement`
2. `tdd`
3. `code-review`
4. `codebase-design`
5. `setup-matt-pocock-skills` (include for completeness of the reference graph; may omit from a _runtime_ pack if policy assumes setup already ran and `docs/agents/issue-tracker.md` is present)

Hard bind remains `/implement` + `/tdd`; the other three are transitive so the agent can follow those skills’ instructions without leaving the pack.
