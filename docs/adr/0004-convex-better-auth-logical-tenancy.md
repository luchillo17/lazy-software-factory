# Convex + Better Auth with logical org tenancy

**Convex** is the data layer and realtime backend; **Better Auth** (Convex adapter) is auth. Convex has no automatic multitenancy or DB-level RLS — isolation is enforced in our queries/mutations (custom function wrappers + organization-scoped indexes). Better Auth’s **organization** plugin covers membership, invites, teams, and roles (identity); domain data still carries and gates on organization ids. Prefer one shared Convex deployment with logical tenancy; domain-per-tenant Convex projects only if compliance demands hard blast-radius walls.

## Status

accepted (direction) — implementation deferred until the product/data slice lands.

## Consequences

- Org plugin typically needs Better Auth **local install** under Convex so org schema lives in-project.
- Sandcastle job credentials resolve per organization at runtime (see ADR-0003), not from one shared host `.env`.
