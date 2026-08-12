# PR draft

Pass-only reference for `/adw-review`. Write from the **pending delta** and ticket context in the prompt.

**Bar:** a human opening the PR knows what landed from the **title** and the **lead paragraph** alone.

## prTitle

Conventional commits (`feat(scope): …` / `fix(scope): …` / …). Name the concrete feature or fix in the pending delta.

**Done when:** the title alone names that concrete change.

## prBody

1. **Lead paragraph** (required): 1–3 sentences — what changed and why. Stands alone.
2. Optional `## Summary` bullets and `## Test plan` checklist.

**Done when:** the lead paragraph alone states purpose so a stranger needs no diff.
