# Phase 4 — Collaboration, privacy and change control

## Objective

Deliver a private collaborative beta with defense-in-depth authorization and safe handling of living people.

## Prerequisites

Phase 0 authentication/authorization boundary and Phases 1–3 domain/query services.

## Work

1. Complete invitation/membership administration using Cloudflare Access identities; roles remain application-managed.
2. Define capabilities by role and tree: view, add suggestions, edit, manage evidence/media, import/export, manage members and delete tree.
3. Implement one authorization policy used by pages, APIs, jobs, exports and object reads.
4. Default uncertain-living people to private. Derive likely-living state from explicit death and configurable age thresholds, while supporting explicit overrides.
5. Apply privacy to records and facts; propagate conservative privacy to unions, relationships, notes, citations and media linked to private people.
6. Provide privacy-safe graph placeholders so permitted relationship structure may be shown without leaking names/details, configurable per tree.
7. Add append-only audit entries with actor, command, affected records and before/after summary.
8. Add contributor suggestions/pending changes and manager approval/rejection. Editors may make direct changes according to policy.
9. Add record history, revert-by-command where safe and conflict review.
10. Ensure exports, logs, caches, R2 keys/metadata and error messages do not bypass privacy.

## Migration and testing

Assign every existing tree an owner before enforcement; block rollout if ownership is ambiguous. Build an exhaustive role × capability × privacy × transport matrix, including indirect inference through search, counts, charts and errors.

## Parallel work

- Policy evaluator and exhaustive matrix tests.
- Audit/change-review persistence and UI.
- Living-state/privacy derivation rules.
- R2/export/cache privacy review.

## Exit criteria

- Capability and privacy matrix tests cover every transport and background job.
- Living and indeterminate people are private by default.
- A viewer cannot infer protected data through search, charts, counts, media URLs or exports.
- Managers can review contributor suggestions and audit/revert changes.
- Access identity failure is fail-closed; local development uses an explicit, non-production identity adapter.
