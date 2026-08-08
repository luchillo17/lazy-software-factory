# The factory is self-building

This repo’s primary customer for the Factory is the Factory. Once the minimum loop exists (skills + Sandcastle + gates + orchestration), we develop lazy-software-factory **through its own ADWs** — triage, implement, gate, review, merge — not as a permanent exception that only humans and ad-hoc chats may change.

Bootstrap is allowed: a thin outer loop (manual skills, stock Sandcastle, human gates) stands up the first ADW; after that, prefer extending the factory by running the factory on this repo’s apps and packages. Designs that cannot eventually run against this repo are suspect.

## Status

accepted

## Consequences

- First vertical slices should be ones we can turn inward (labels, gates, package scaffolding) soon after they work outward.
- Hosted multi-org and extractable packages still matter — self-building is the sharpness test, not the only deployment mode.
- Prefer the term **Self-building** over **Self-hosting** here — self-hosting means on-prem/local deploy in this project.
