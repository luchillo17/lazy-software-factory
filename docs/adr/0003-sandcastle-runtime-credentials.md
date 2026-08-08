# Configure Sandcastle per run; do not require one server per tenant

Sandcastle’s `.sandcastle/.env` is local/dev convenience. Agent and sandbox providers accept runtime `env`, and `run()` accepts per-invocation `cwd`, prompts, and hooks. Hosted multitenancy therefore injects org secrets (from a vault or our store) at job time — we do **not** need domain-level multitenancy (one server process or deploy per tenant) just because Sandcastle uses dotenv files. Stronger isolation (worker pools, separate deploys) remains an ops/compliance choice, orthogonal to the library.

## Status

accepted
