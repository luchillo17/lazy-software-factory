# ADW attempt caps + structured Review verdict

Orchestration owns loop termination and Review routing for the minimal ADW (ADR-0007). **Build attempts** and **Review attempts** are **separate counters** — do not share one budget, and **do not charge Review→Build resumes against the Build cap**.

- **Build attempt** (default cap **5**): each Build agent create/resume in the **Build↔Test** loop only. Test-agent fail → resume Build spends one Build attempt. Exhaust Build attempts → ADW `failed`.
- **Review attempt** (default cap **3**): each Review agent run (always a **new** agent session). Review-fail → resume Build with the fail report does **not** spend a Build attempt; only the Review run that failed spent a Review attempt. Exhaust Review attempts → ADW `failed` even if Build attempts remain.

Review emits a **structured Review verdict** (`pass` | `fail` plus, on fail, a fail report of Bugbot-shaped findings). Orchestration parses that verdict to route; malformed/unknown counts as fail and spends a Review attempt. Review does **not** auto-fix — fail report is feedback when resuming the **original Build** session. This keeps hard Test gates coded (ADR-0005) while still giving Review a machine-checkable advance decision.

## Status

accepted

## Considered Options

- **Charge Review-fail→Build against the Build attempt cap** — rejected; Review thrash would burn the Build↔Test budget; Review already has its own cap.
- **Single shared attempt counter for Build and Review** — rejected; Review judgment loops differently from Test-fail resumes and would starve or over-burn the wrong side.
- **Unbounded resume until human abort** — rejected; token burn and zombie tickets.
- **Free-text-only Review / advisory Review that never blocks** — rejected for minimal ADW; we need parseable pass/fail and fail-report feedback for Build resume.
- **Review auto-fixes findings** — rejected for v0; Fix/dismiss stays human or later; ADW Review reports, Build implements.
