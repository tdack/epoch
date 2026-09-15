# Phase 0 — Foundations and architecture

## Objective

Turn the prototype into a safe base for relationship work without building broad features.

## Prerequisites

None. Preserve a database export and representative GEDCOM export before migration work starts.

## Work

1. Record architecture decisions for identity, genealogy IDs, GEDCOM preservation, date representation and concurrency.
2. Split the application into domain types/commands, persistence repositories, query services and SvelteKit transport/UI layers.
3. Replace request-time schema creation with versioned D1 migrations and local/test database setup.
4. Validate Cloudflare Access JWT assertions at the Worker using configured issuer/audience and rotating JWKS. Upsert a local user by stable Access subject; treat email as mutable profile data.
5. Add tree memberships and application roles: `owner`, `manager`, `editor`, `contributor`, `viewer`. Centralize authorization and deny by default in every server endpoint/action.
6. Establish typed errors, request validation, optimistic version fields, privacy-safe structured logs and correlation IDs.
7. Create representative fixtures: remarriage after divorce, remarriage after death, one child with two mothers, multiple parental families, adoption, foster care, guardian, unknown parent, same-sex partners, incomplete people and uncertain dates.
8. Add domain unit tests, repository integration tests against local D1, route authorization tests and one browser smoke path.
9. Break the large page into route-level screens and reusable primitives; retain visual styling only where it helps.

## Decisions to lock

- Internal UUIDs are independent from GEDCOM XREFs; XREFs are import/export aliases scoped to a tree/import.
- Worker code validates Access tokens even when Access protects the hostname.
- No UI or route handler writes tables directly; mutations use domain commands.
- All mutable records have version/change metadata to prevent silent collaborator overwrites.

## Migration and compatibility

Create a repeatable baseline migration from the existing database, but do not yet reinterpret relationships. Keep compatibility reads only as short-lived adapters. Remove runtime schema mutation once fresh and upgrade paths are tested.

## Parallel work

- Access/auth middleware and role-policy tests.
- D1 migration/test harness and repository skeleton.
- Relationship editor wireframes tested against core fixtures.
- GEDCOM conformance fixture collection.

These converge on agreed domain interfaces before Phase 1 implementation.

## Exit criteria

- Anonymous, invalid-audience and unauthorized requests are rejected in tests.
- Migrations create a fresh local database and upgrade a prototype fixture.
- A domain command runs through service/repository boundaries without route coupling.
- Existing `check`, `test` and `build` scripts pass.
- Fixture scenarios and architecture decisions are reviewed and stable enough for the core schema.
