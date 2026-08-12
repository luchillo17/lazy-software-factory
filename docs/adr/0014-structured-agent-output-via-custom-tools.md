# Structured Agent output via local customTools

When orchestration **consumes structured output** from an LLM **Agent** (and would otherwise resume on decode failure), capture that payload through Cursor SDK **`local.customTools`** submit tools — **tool-only** for routing. Effect Schema in tool `execute` is the hard check; JSON Schema `inputSchema` is a soft guide only. Domain structs (`ReviewOutput`, future peers) stay the source of truth; tools are transport.

ADW Agents run as SDK **`local`** agents against the Factory **warm sandbox** (Host or cloud box). We do **not** use Cursor **`cloud` Agent.create** for ADWs, so in-process `customTools` apply in every supported sandbox — MCP is not required for submit-verdict tools.

**Review** is the first consumer: `submit_review_pass` / `submit_review_fail`; last successful tool call wins; orchestration reads the accepted tool stash, not final-message prose. Assistant prose may still stream for humans / progress; it is **not** the wire. **Build** has no submit tools in v0 — Test agent gates the loop; orchestration does not branch on Build structured output.

A **wire miss** is a post-run harvest with no accepted tool payload (or equivalent decode failure at harvest). Resume the same Agent session under the existing inner resume budget (ADR-0009 for Review). In-session tool `isError` / execute decode failures do **not** burn that budget; they are the intended in-run repair path. Progress naming moves from `schema_miss` to **wire miss** with the implementation cutover.

## Status

accepted

## Considered Options

- **Final-message JSON + schema-resume as the primary wire** — rejected for structured Agent output; Host spike showed prose shape thrash (multiple resumes) vs tool submit (zero resumes) on the same subject.
- **Hybrid tool stash + prose fallback** — rejected; reintroduces prose thrash for routing.
- **Require MCP before tool-only (Cursor hosted cloud agents)** — rejected; Factory supplies the sandbox and uses SDK local agents; Cursor `cloud` Agent.create is out of scope for ADWs.
- **Submit tools on Build in the same cutover** — rejected for v0; no orchestration consumer of Build structured output.
- **Fold this into ADR-0009 only** — rejected; caps and Review verdict _shape_ stay in 0009; transport inflection deserves its own record.

## Consequences

- Amend ADR-0009 wording: obtain Review verdict via submit tools (this ADR); keep attempt caps and pass/fail routing.
- Planner (and any later LLM Agent) adopts the same rule when its artifact becomes orchestration-parsed.
- Cloud sandbox ≠ Cursor cloud agent runtime.
