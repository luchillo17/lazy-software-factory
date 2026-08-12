# Test agent: parallel check-only gates + full fail report

The **Test agent** (coded gate node, ADR-0005 / ADR-0007) runs orchestration-owned checks as **read-only** commands (lint, format `--check`, typecheck, unit tests, policy — no mutating format/fix). Independent checks run **in parallel** via the Runtime sandbox. If any check is red, orchestration resumes Build with a **combined fail report** that includes every failing gate’s exit code and stdout/stderr — not fail-fast on the first red.

**Host resolution:** gates come from the sandbox cwd `package.json` `scripts` (first hit per category: typecheck / lint / test), invoked as `<packageManager> run <script>`. Do not hardcode Factory nx project lists into Host Test.

Mutating steps (e.g. `prettier --write`) do **not** belong in the Test agent; keep those in Build or a separate provision/setup step.

## Status

accepted

## Considered Options

- **Sequential fail-fast (first red only)** — rejected; Build gets partial feedback and must rediscover other reds on the next attempt.
- **LLM “test agent” that interprets failures** — rejected for v0; keep the gate coded (ADR-0005).
- **Allow write-mode format inside Test agent** — rejected; races and non-determinism under parallel exec.
