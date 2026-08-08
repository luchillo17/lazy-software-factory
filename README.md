# lazy-software-factory

Open-source **AI developer workflows** (a software factory) built on:

- [Sandcastle](https://github.com/mattpocock/sandcastle) — sandbox / branch / parallel agent **primitives**
- [mattpocock/skills](https://github.com/mattpocock/skills) — engineering **process** (grill → tickets → TDD → review)
- IndyDevDan-style ADWs — **code owns the gates** (lint / typecheck / test / route); agents own judgment

The goal is a factory you can run locally (WSL + Docker recommended), with orchestration you own in TypeScript — not a single mega-skill that lints, tests, and reviews itself.

## Status

Early bootstrap. Public so people can contribute while the shape settles.

**Explicitly undecided (on purpose):**

| Decision | Status |
| --- | --- |
| Nx monorepo | Deferred — start without Nx; adopt if the package graph needs it |
| Cloud SaaS | Deferred — local/self-hosted factory first; cloud is a later product question |

## Repo layout (intentional thin start)

```text
docs/           design notes & ADRs
packages/       future shared libs / factory orchestration
apps/           future CLIs or services (only if needed)
```

No Nx, no cloud control plane yet. Structure stays easy to promote into either later.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Issues and PRs welcome — especially around ADW shapes, Sandcastle orchestration patterns, and hard deterministic gates between agent nodes.

## License

[MIT](./LICENSE)
