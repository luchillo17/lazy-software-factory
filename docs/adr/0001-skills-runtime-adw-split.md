# Skills, Runtime, and ADW orchestration stay separate

We build an IndyDevDan-style software factory from three layers: **mattpocock/skills** own agent process/behavior, **our Effect Runtime** (`packages/runtime`) owns sandbox lifecycle and agent providers (e.g. Cursor SDK), and **ADW orchestration** (`packages/adw`) owns pass/fail routing (hard gates). [Sandcastle](https://github.com/mattpocock/sandcastle) is prior-art reference only — **not** part of this stack. This keeps the factory inspectable and avoids a single mega-skill that lints, tests, and reviews itself.

## Status

accepted
