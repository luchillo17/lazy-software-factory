# Runtime credentials per run; root `.env` for local

Local development uses a **repo-root** `.env` (gitignored) plus `.env.example` for keys such as `CURSOR_API_KEY` and `GH_TOKEN`. The Runtime and ADW accept per-invocation credentials and config (env, cwd, prompts). Hosted multitenancy injects Organization secrets (vault or our store) at job time — we do **not** need one server process or deploy per Organization just because local setup uses dotenv. Stronger isolation (worker pools, separate deploys, BYO sandbox accounts) remains an ops/compliance choice, orthogonal to the library.

## Status

accepted

## Considered Options

- **One server / deploy per tenant for secrets** — rejected; per-run injection is enough for the Runtime seam.
- **Sandcastle `.sandcastle/.env` as the long-term local path** — rejected; Sandcastle is not in our stack; root `.env` is the local convention.
