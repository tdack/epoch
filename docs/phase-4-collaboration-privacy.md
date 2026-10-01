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

## Status against the work items

Slice S8 (2026-10-01) did the privacy foundation; see the [S8 status](./improvement-plan.md#s8-privacy-foundation).

| Work item | Status |
|---|---|
| 1. Invitations and membership administration | Waiting. There is no way to add a member except the database. |
| 2. Capabilities by role | Partly: `person:set_privacy`, `media:manage`, `media:view` added; `tree:export` raised to manager. Suggestions and evidence capabilities wait. |
| 3. One authorization policy | Partly: one `ViewerScope` and `canSeePrivatePeople`; every read service and the mutation runner use it. Jobs: the export workflow re-checks. |
| 4. Living people private by default | Done (ADR-015). |
| 5. Privacy on records, facts, unions | Done for people, their names and facts, partnerships and links. Notes, citations and media follow the person only. |
| 6. Privacy-safe placeholders | Done, per tree, graph and family lists. |
| 7. Audit | Waiting (the change log is the start of it). |
| 8. Suggestions and approval | Waiting. |
| 9. History, revert, conflict review | Waiting. |
| 10. Exports, logs, caches, R2, errors | Partly: export is manager-only, media reads are checked and `private`-cached, a private id answers as a missing one. A filtered export and log review wait. |

Exit criteria: "Living and indeterminate people are private by default" and "a viewer cannot infer protected data through search, charts, counts, media URLs or exports" are met for the transports in `src/routes/privacy-matrix.test.ts`. "Managers can review suggestions and audit/revert" waits. "Access identity failure is fail-closed; local development uses an explicit adapter" was already so (`ACCESS_BYPASS_DEV`).
