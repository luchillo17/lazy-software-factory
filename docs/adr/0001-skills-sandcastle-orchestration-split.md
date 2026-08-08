# Skills, Sandcastle, and orchestration stay separate

We build an IndyDevDan-style software factory from three layers: **mattpocock/skills** own agent process/behavior, **Sandcastle** owns sandbox/branch/parallel runtime primitives, and **our TypeScript orchestration** owns pass/fail routing (hard gates). Stock Sandcastle templates are learning scaffolds only — not the long-term control plane. This keeps the factory inspectable and avoids a single mega-skill that lints, tests, and reviews itself.
