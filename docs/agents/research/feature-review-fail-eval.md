# Research: Eval approach for Feature Review-fail routing

**Issue:** [#32](https://github.com/luchillo17/lazy-software-factory/issues/32) (child of [#26](https://github.com/luchillo17/lazy-software-factory/issues/26))  
**Question:** What eval design (harness shape, metrics, fixtures) can decide whether Review-fail inside a nested **Minimal ADW** should stay a local Build resume or bubble to a parent **Feature ADW**’s **Planner Agent**?  
**Non-goal:** Pick the product policy. Surface how evidence would choose among **local**, **bubble**, and **tiered**.

Domain framing (`CONTEXT.md`): **Minimal ADW** = Build↔Test→Review→Ship with own attempt caps; **Feature ADW** = Planner Agent + nested Minimal; shared warm sandbox. If Minimal is root, local Review→Build stands (ADR-0007 / ADR-0009). The open decision is only the nested case.

---

## 1. What “routing” means here

After a structured **Review verdict** of `fail` (ADR-0009):

| Option     | Behavior when Minimal is nested under Feature                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local**  | Always resume the same Build session with the fail report (today’s Minimal behavior). Planner does not see the fail until Minimal exhausts Review attempts / ADW `failed`. |
| **Bubble** | On Review-fail, escalate to Planner (re-plan / rewrite ticket slice / abort) instead of (or before) another Build resume.                                                  |
| **Tiered** | Route by class of fail: some failures stay local; others bubble (e.g. after N local resumes, or when findings look like scope/spec bugs).                                  |

Root Minimal: eval suite must keep a **control arm** that asserts local loop still applies (no Planner in graph).

In-repo prior art already encodes the _local_ path as Effect tests with mocked providers (`packages/adw/src/review-routing.spec.ts`): Review-fail resumes Build without spending Build attempts; malformed verdict spends a Review attempt; Review-cap exhaust → `failed` while Build attempts remain. That is regression coverage for orchestration mechanics, not a policy comparison. The research gap is a **policy eval** that scores which routing choice wins on nested Feature runs.

---

## 2. Primary methodology (how to know)

### 2.1 Vendor / industry primary sources

**Anthropic — Demystifying evals for AI agents** ([anthropic.com/engineering/demystifying-evals-for-ai-agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), Jan 2026):

- Eval = task → trial(s) → transcript/trace + outcome → graders → aggregate.
- **Evaluation harness** runs tasks, records steps, grades, aggregates; distinct from the **agent harness** under test (here: Feature/Minimal ADW orchestration + Runtime).
- Prefer **code-based graders** when possible; **model-based** with structured rubrics when needed; **human** for calibration.
- Grade **outcome** and selected **process** signals; avoid brittle “exact tool sequence” checks that punish valid paths.
- Start with **20–50** tasks from real failures; balanced positive/negative cases; multiple trials (`pass@k` / `pass^k`) for non-determinism.
- Capability vs regression suites; read transcripts when scores disagree with intuition.

**OpenAI — Agent / skill eval pattern** ([Testing Agent Skills Systematically with Evals](https://developers.openai.com/blog/eval-skills); [Trace grading](https://developers.openai.com/api/docs/guides/trace-grading)):

- Concretely: prompt → captured run (trace + artifacts) → small set of checks → comparable score.
- Split success into **outcome**, **process**, **style**, **efficiency** goals.
- Deterministic checks on traces first (did the expected handoff/resume happen?); add rubric/LLM judges for qualitative axes.
- Trace grading asks routing-shaped questions: right tool / right handoff / did a routing change improve end-to-end behavior?

**OpenAI — Agent improvement loop** ([Agents SDK cookbook: traces → feedback → evals](https://developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop)):

- Flywheel: real traces → human/model feedback → reusable offline evals → harness changes. Fits “don’t pick policy until evidence” — fixtures come from observed Review thrash, then policies compete offline.

### 2.2 Academic / benchmark primary sources (routing & orchestration)

These are not product recommendations; they supply **metric shapes** for “local vs escalate”:

| Source                                                        | Relevant idea for this ticket                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [OrchestraBench](https://arxiv.org/html/2608.05263v1) (2026)  | Treat **routing mechanism** and **failure recovery** as first-class; measure **cascade radius**, per-failure-mode recovery; compare policies with paired tests / CIs. Blind retry often fails latent/semantic modes — detection/attribution matters. |
| [DecisionBench](https://arxiv.org/html/2605.19099) (2026)     | End-task quality can be **flat** across routing awareness while **delegation fidelity** moves — process metrics must sit beside outcome.                                                                                                             |
| [TwinRouterBench](https://arxiv.org/html/2605.18859v1) (2026) | **Two-track** design: cheap **static** step-level labels for fast iteration + **dynamic** live end-to-end harness for confirmation. Deterministic scoring where possible (no online judge on the critical path).                                     |

### 2.3 Mapping sources → this Factory

| Method idea                         | Factory application                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Task / trial / transcript / outcome | Ticket fixture → Feature ADW run → ADW event log + sandbox git state → Ship/`failed` + attempt counters     |
| Code graders                        | Assert route taken (`resume_build` vs `planner_handoff`); attempt budgets; Test green/red; PR opened or not |
| Model graders                       | Label Review fail report as `local_fixable` vs `needs_replanning` (calibrate vs human)                      |
| Two-track (TwinRouter)              | Static: gold labels on frozen Review-fail snapshots; Dynamic: full nested ADW with stub/real agents         |
| Cascade radius (Orchestra)          | After wrong local-only loop: how many wasted Review attempts / tokens before inevitable fail                |
| Balanced triggers (Anthropic)       | Fixtures that _should_ stay local and _should_ bubble — avoid always-escalate overfitting                   |

---

## 3. Proposed harness shape

### 3.1 Unit under test

Three **policy adapters** behind one Feature ADW seam (same Runtime, same warm-sandbox rules, same ADR-0009 counters unless a policy explicitly documents a different charge rule):

1. `policy_local` — always Review-fail → Build resume (baseline = current Minimal).
2. `policy_bubble` — always Review-fail → Planner (then Planner may restart Minimal / rewrite / fail).
3. `policy_tiered` — classifier or rules over Review fail report (+ attempt index) → local or bubble.

Root Minimal control: run the same ticket fixtures under Minimal-only with `policy_local` only.

### 3.2 Two tracks (recommended)

**Track A — Static routing diagnostic (cheap, deterministic)**

- Input: frozen **Review-fail snapshot** (structured verdict + fail report + ticket text + optional prior attempt count).
- Actor: routing policy only (no full LLM Build).
- Gold label: `local` | `bubble` (human or calibrated judge; held-out set).
- Score: precision/recall/F1 vs gold; cost = near-zero LLM if rule-based; if LLM router, still no Build loop.
- Mirrors OrchestraBench Exp-1 style “isolate routing mechanism” and TwinRouterBench static track.

**Track B — Dynamic nested ADW (expensive, decisive)**

- Input: ticket fixture + seeded repo sandbox.
- Actor: full Feature ADW (Planner + nested Minimal) under each policy.
- Agents: start with **stub providers** (scripted Review fail reports / Planner responses) for CI; graduate to live models for capability suite.
- Outcome: ADW status, attempt usage, tokens/time, whether final patch matches fixture oracle tests.
- Mirrors Anthropic coding-agent outcome graders + OpenAI process/efficiency goals + TwinRouter dynamic track.

### 3.3 Isolation & fidelity

Per Anthropic: each trial starts from a clean sandbox; agent harness in eval ≈ production Feature/Minimal path. Do not share git state across trials. Prefer the same `runMinimalAdw` / future `runFeatureAdw` entrypoints used in product (extend Effect Layer injection like `review-routing.spec.ts`).

### 3.4 Trials

- Stub/CI suite: `k=1` often enough (deterministic scripts).
- Live-model suite: report `pass@1` and `pass^k` (e.g. k=3) on outcome success; routing accuracy can stay single-shot if the router is deterministic.

---

## 4. Metrics (what evidence looks like)

### 4.1 Primary (must drive the decision)

| Metric                         | Definition                                                                     | Why                                                         |
| ------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| **Task success rate**          | Fraction of fixtures ending `shipped` / `ready_for_pr` with oracle tests green | Outcome first (Anthropic coding agents; TwinRouter dynamic) |
| **Routing agreement (static)** | P/R/F1 vs gold `local`/`bubble`                                                | Isolates policy without Build noise                         |
| **Wrong-route cost**           | Expected wasted Review attempts + tokens when policy disagrees with gold       | Cascade / thrash (Orchestra; OpenAI efficiency)             |
| **Root-Minimal invariance**    | Local loop still correct when no Feature parent                                | Guards glossary rule                                        |

### 4.2 Secondary (break ties, expose gaming)

| Metric                             | Definition                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| **Review attempt efficiency**      | Success / Review attempts used (cap from ADR-0009 default 3)                        |
| **Planner invocation rate**        | Planner calls per ticket (bubble/tiered only)                                       |
| **Time / token / $ per success**   | Realized spend (TwinRouter dynamic accounting)                                      |
| **False bubble rate**              | Local-fixable fails escalated (wastes Planner, may thrash plan)                     |
| **False local rate**               | Spec/scope fails kept in Build loop until Review cap (classic thrash)               |
| **Delegation fidelity** (optional) | Among escalations, Planner action matched gold class (DecisionBench process signal) |

### 4.3 Decision rule (evidence → choice — still not a product pick)

Run Track A + Track B under the three policies on the same fixture bank. Prefer the policy that:

1. Maximizes **task success** (or is within a pre-registered CI of the best), **and**
2. Minimizes **wrong-route cost** / Review thrash, **and**
3. Does **not** regress root-Minimal invariance, **and**
4. On static Track A, does not sacrifice F1 below a pre-registered floor (stops “always bubble” gaming success via Planner rewrites that inflate cost).

If success is flat across policies but process metrics diverge (DecisionBench pattern), pick by **wrong-route cost** and **Planner invocation** Pareto — document the trade-off; do not invent a winner from vibes.

If tiered wins static F1 but loses dynamic success, prefer dynamic outcome until fixtures or classifier improve (TwinRouter: static for iteration, dynamic for lock).

---

## 5. Fixtures

### 5.1 Taxonomy (balanced classes)

Build a small bank (~20–40) before scaling. Each fixture declares gold route + oracle.

| Class                                    | Gold route                                       | Example seed                                                                              |
| ---------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| **L1 — Local fix**                       | `local`                                          | Review finds missing null check / wrong assertion; ticket scope correct                   |
| **L2 — Local after Test**                | `local`                                          | Review fail, Build fix, Test red once, then green (existing unit-test pattern)            |
| **B1 — Scope / wrong ticket**            | `bubble`                                         | Review finds implementation of wrong acceptance criteria; Build cannot fix without replan |
| **B2 — Conflicting requirements**        | `bubble`                                         | Ticket contradicts repo invariants; Planner must rewrite or fail closed                   |
| **B3 — Missing dependency / epic split** | `bubble`                                         | Review findings imply work outside ticket; needs Planner decomposition                    |
| **T1 — Ambiguous**                       | gold = tiered rule (e.g. local once then bubble) | Borderline findings; used only if evaluating tiered                                       |
| **C0 — Root Minimal control**            | always `local`                                   | Same L1/L2 without Feature parent                                                         |

Source fixtures from real dogfood failures when available (Anthropic Step 1); until then, hand-author from ADR-0009 thrash scenarios and Review verdict shapes in `packages/adw`.

### 5.2 Fixture package shape (suggested)

```text
fixtures/review-fail-routing/
  <id>/
    ticket.md              # prompt / acceptance
    repo/                  # or patch against a shared base
    oracle/                # tests or expected files
    review_fail.json       # structured ReviewVerdict fail + report (Track A)
    gold.json              # { "route": "local"|"bubble", "notes": "..." }
    meta.json              # class, difficulty, nested: true|false
```

Track A consumes `review_fail.json` + `gold.json`.  
Track B mounts `repo/`, runs Feature ADW, grades with `oracle/` + status enums (`AdwStatus`).

### 5.3 Stub scripts for CI

Mirror `review-routing.spec.ts`: Layer-injected Build/Review/Planner providers that emit scripted verdicts. Assert:

- Under `policy_local`, Planner never called on Review-fail.
- Under `policy_bubble`, first Review-fail invokes Planner before further Build resume (or per policy contract).
- Under `policy_tiered`, route matches gold for scripted reports.
- Caps still enforce ADR-0009 unless a policy ADR explicitly changes charging.

---

## 6. Graders

1. **Deterministic (required):** route event; attempt counters; ADW status; oracle test exit codes; “Planner called?” boolean.
2. **Structured LLM rubric (optional, Track A gold assist / live fail-report labeling):** dimensions `scope_mismatch`, `fixable_in_place`, `needs_human` → map to route; calibrate on 20 human labels (Anthropic); allow `Unknown`.
3. **Human spot-check:** read transcripts when policies disagree on success or when static F1 and dynamic success conflict.

Do not grade “exact Build tool sequence.” Grade whether the **orchestration route** and **final outcome** match intent.

---

## 7. How this chooses among local / bubble / tiered

| Evidence pattern                                               | Interpretation                                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Local ≈ bubble on success, local lower cost                    | Prefer **local**; bubble adds Planner overhead without gain                                    |
| Bubble ≫ local on B-class, local wins L-class, flat overall    | Prefer **tiered** if static F1 high; else need better classifier before shipping bubble-always |
| Always-bubble wins success only via expensive Planner rewrites | Reject on wrong-route cost / token Pareto                                                      |
| Tiered static F1 high, dynamic success ≤ local                 | Classifier OK offline but integration broken — fix harness before adopting                     |
| Root Minimal regressions under any policy                      | Block ship; routing must be parent-aware                                                       |

**Still no product answer:** this document only defines the measurement system. A later grilling/ADR ticket locks the policy after Track A+B results exist.

---

## 8. Suggested rollout (eval-driven, not product-driven)

1. Codify route events + fixture schema in `packages/adw` (or `packages/adw-evals`).
2. Port current Review routing unit tests as **regression** suite for `policy_local` mechanics.
3. Land Track A with ~20 gold-labelled `review_fail.json` fixtures (human labels).
4. Land Track B stubs for L1/B1 minimum; CI gate on deterministic assertions.
5. Optional live-model capability suite offline; promote saturated tasks to regression (Anthropic).
6. Only then: product ADR choosing local / bubble / tiered from pre-registered decision rule (§4.3).

---

## 9. Sources

### In-repo

- `CONTEXT.md` — Minimal / Feature / Review attempt / Review verdict
- `docs/adr/0007-minimal-adw-build-test-review.md` — Minimal graph; Review-fail may resume Build
- `docs/adr/0009-adw-attempt-caps-review-verdict.md` — Separate caps; structured verdict; no Review auto-fix
- `packages/adw/src/review-routing.spec.ts` — Effect tests for local Review→Build, malformed verdict, Review-cap exhaust
- Parent map: issue #26 (nested Minimal Review-fail vs Planner bubble still foggy)

### External primary

- Anthropic Engineering, _Demystifying evals for AI agents_ (2026): https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- OpenAI Developers, _Testing Agent Skills Systematically with Evals_: https://developers.openai.com/blog/eval-skills
- OpenAI API, _Trace grading_: https://developers.openai.com/api/docs/guides/trace-grading
- OpenAI Cookbook, _Build an Agent Improvement Loop with Traces, Evals, and Codex_: https://developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop
- Chen et al., _OrchestraBench_ (arXiv HTML): https://arxiv.org/html/2608.05263v1
- _DecisionBench_ (arXiv HTML): https://arxiv.org/html/2605.19099
- _TwinRouterBench_ (arXiv HTML): https://arxiv.org/html/2605.18859v1
