# Schema closed sets (const object + `Schema.Enum`)

**House default:** any **closed wire set** (finite named values with stable string/number encodings) uses const object + `Schema.Enum`. Call sites pick by key; they do not paste wire strings. Applies everywhere Effect Schema is used — not a single package or domain noun.

## Canonical shape

```ts
export const ExampleKind = {
  Alpha: "alpha",
  Beta: "beta",
} as const;

export const ExampleKindSchema = Schema.Enum(ExampleKind);
export type ExampleKind = typeof ExampleKindSchema.Type;
```

Call sites: `ExampleKind.Alpha`. Decode/encode: `ExampleKindSchema`. Field types: `typeof ExampleKindSchema.Type` (or `import type { ExampleKind }` alone — do **not** import value + type under the same name in one file; that hits `TS2300` with this workspace's TS settings). Re-export barrels with `export *`.

## When to use

- Any closed string/number set with stable wire values and named members at call sites (statuses, verdicts, kinds, roles, modes, phases, … — the noun does not matter).
- Domain vocabulary from `CONTEXT.md` / ADRs when it is a closed set.

## Prefer other tools instead

- **`Schema.Literals([...])`** — anonymous literal union only (no key map). Fine for one-off decode; not for repeated call-site construction.
- **`Schema.TaggedError` / tagged structs** — error and variant _shapes_ (`_tag`), not closed-value maps.
- **Open strings** (`Schema.String`) — free text, ids, messages.

## Do not

- Hand-write `"a" | "b" | "c"` on public APIs when a const map exists or should.
- Hardcode wire strings at call sites when `Foo.Bar` exists.
- Treat this pattern as ADW-only or “status-field-only.”

## Workspace illustrations (not an allowlist)

- `packages/adw/src/enums.ts` — `AdwStatus`, `ReviewVerdict`
