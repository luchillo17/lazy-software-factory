# ADW attempt caps + structured Review verdict

Orchestration owns loop termination and Review routing for the minimal ADW (ADR-0007). **Build attempts** and **Review attempts** are **separate counters** — do not share one budget, and **do not charge Review→Build resumes against the Build cap**.

- **Build attempt** (default cap **5**): each Build agent create/resume in the **Build↔Test** loop only. Test-agent fail → resume Build spends one Build attempt. Exhaust Build attempts → ADW `failed`.
- **Review attempt** (default cap **3**): each Review agent **create** when entering Review from Build/Test (always a **new** agent session for that entry). A valid Review-fail → resume Build with the fail report does **not** spend a Build attempt; only that Review **create** spent a Review attempt. Exhaust Review attempts → ADW `failed` even if Build attempts remain.

Review must emit a **structured Review verdict** (`ReviewOutput`: `pass` | `fail` plus, on fail, a fail report of Bugbot-shaped findings). Orchestration owns the wire contract: the Review **create** prompt includes the expected shape; orchestration parses with schema decode to route.

- **Schema miss** (malformed/unknown output): **resume the same Review session** with decode error + expected shape + redacted/truncated prior output. Schema resumes do **not** spend an extra Review attempt; they use an **inner schema-resume cap** (v0 default **3**) per Review session. Exhaust that cap → ADW `failed`. Do **not** send schema miss to Build.
- **Valid fail**: fail report is feedback when resuming the **original Build** session.
- **Valid pass**: advance to Ship.

Review does **not** auto-fix. This keeps hard Test gates coded (ADR-0005) while still giving Review a machine-checkable advance decision and keeping agent-to-agent output schema-compatible.

## Status

accepted

## Considered Options

- **Charge Review-fail→Build against the Build attempt cap** — rejected; Review thrash would burn the Build↔Test budget; Review already has its own cap.
- **Single shared attempt counter for Build and Review** — rejected; Review judgment loops differently from Test-fail resumes and would starve or over-burn the wrong side.
- **Unbounded resume until human abort** — rejected; token burn and zombie tickets.
- **Free-text-only Review / advisory Review that never blocks** — rejected for minimal ADW; we need parseable pass/fail and fail-report feedback for Build resume.
- **Review auto-fixes findings** — rejected for v0; Fix/dismiss stays human or later; ADW Review reports, Build implements.
- **Schema miss counts as Review-fail and resumes Build** — rejected; Build must not debug Review JSON. Schema is the agent-to-agent wire contract; format repair stays on the Review session.
- **New Review session on every schema miss** — rejected; the review already ran — the agent needs output-shape guidance, not a cold restart.
- **Charge every schema resume as a Review attempt** — rejected; create already charged the judgment entry; unbounded format thrash is bounded by the inner schema-resume cap instead.
