# Contributing

Thanks for helping shape **lazy-software-factory**.

## Principles

1. **Agents propose, code disposes** — agents **can** run lint, format, typecheck, and tests while building if that helps them (e.g. TDD / `/implement`). We don't prescribe how agents work. What matters is **pass/fail routing**: orchestration still runs those checks as hard gates after (or between) agent steps — green advances, red routes back. Code decides whether the workflow may continue.
2. **Skills = behavior, Sandcastle = runtime** — process lives in skills/prompts; isolation and parallelism live in Sandcastle (or equivalent).
3. **Keep the control plane thin and inspectable** — prefer small TypeScript workflows over one opaque agent session.
4. **Defer lock-in** — don't assume Nx or a cloud product until there's a clear need.

## How to help

- Open an issue for ADW designs, gate designs, or Sandcastle template ideas before large PRs.
- Prefer vertical slices with tests over broad scaffolding.
- Use clear PR descriptions: problem → approach → how to verify.

## Local setup (recommended)

- **WSL2 (Ubuntu)** + Git + `gh`
- **Docker** (for Sandcastle sandboxes)
- Node.js LTS (when packages land)

Exact bootstrap commands will land with the first factory package.

## Code of conduct

Be respectful. Assume good intent. Disagreement is fine; dismissiveness isn't.
