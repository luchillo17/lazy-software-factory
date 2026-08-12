# ADW attempt caps + structured Review verdict

Orchestration owns loop termination and Review routing for the minimal ADW (ADR-0007). **Build attempts** and **Review attempts** are **separate counters** — do not share one budget, and **do not charge Review→Build resumes against the Build cap**.

- **Build attempt** (default cap **5**): each Build agent create/resume in the **Build↔Test** loop only. Test-agent fail → resume Build spends one Build attempt. Exhaust Build attempts → ADW `failed`.
- **Review attempt** (default cap **3**): each Review agent **create** when entering Review from Build/Test (always a **new** agent session for that entry). A valid Review-fail → resume Build with the fail report does **not** spend a Build attempt; only that Review **create** spent a Review attempt. Exhaust Review attempts → ADW `failed` even if Build attempts remain.

Review must produce a **structured Review verdict** (`ReviewOutput`: **pass** with non-empty **`prTitle` + `prBody`**, or **fail** with a fail report of Bugbot-shaped findings). Orchestration owns the wire contract and routing. **How** the verdict is captured from the Review LLM (submit tools) is ADR-0014 — tool-only for structured Agent output.

- **Wire miss** (no accepted structured verdict at harvest — including missing PR draft fields on pass): **resume the same Review session** with guidance + redacted/truncated prior output. Wire-miss resumes do **not** spend an extra Review attempt; they use an **inner wire-miss resume cap** (v0 default **3**) per Review session. Exhaust that cap → ADW `failed`. Do **not** send wire miss to Build. Progress kind: `wire_miss` / step result `wire_resume`.
- **Valid fail**: fail report is feedback when resuming the **original Build** session.
- **Valid pass**: build **`ShipInput`** from pass fields + sandbox/ticket context; advance to the **Ship agent**.

Review does **not** auto-fix. This keeps hard Test gates and Ship forge ops as **Code agents** (ADR-0005) while still giving Review a machine-checkable advance decision and keeping agent-to-agent output schema-compatible.

## Status

accepted

## Considered Options

- **Charge Review-fail→Build against the Build attempt cap** — rejected; Review thrash would burn the Build↔Test budget; Review already has its own cap.
- **Single shared attempt counter for Build and Review** — rejected; Review judgment loops differently from Test-fail resumes and would starve or over-burn the wrong side.
- **Unbounded resume until human abort** — rejected; token burn and zombie tickets.
- **Free-text-only Review / advisory Review that never blocks** — rejected for minimal ADW; we need parseable pass/fail and fail-report feedback for Build resume.
- **Review auto-fixes findings** — rejected for v0; Fix/dismiss stays human or later; ADW Review reports, Build implements.
- **Wire miss counts as Review-fail and resumes Build** — rejected; Build must not debug Review wire shape. Format repair stays on the Review session.
- **New Review session on every wire miss** — rejected; the review already ran — the agent needs output-shape guidance, not a cold restart.
- **Charge every wire-miss resume as a Review attempt** — rejected; create already charged the judgment entry; unbounded format thrash is bounded by the inner resume cap instead.
