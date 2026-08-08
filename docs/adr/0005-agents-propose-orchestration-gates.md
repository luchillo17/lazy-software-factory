# Agents may run checks; orchestration owns hard gates

Agents **can** run lint, format, typecheck, and tests while building when that helps (e.g. TDD / `/implement`). We do not prescribe how agents work. What must not blur: **pass/fail routing** belongs to orchestration — those same checks run again as hard gates between (or after) agent steps; green advances, red routes back. Code decides whether the workflow may continue.

## Status

accepted

## Considered Options

- **Forbid agents from running tests** — rejected; fights useful agent loops and is unenforceable in practice.
- **Trust agent-reported green without orchestration gates** — rejected; agents own judgment, not the factory’s advance/retry decision.
