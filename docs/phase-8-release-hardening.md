# Phase 8 — Release hardening

## Objective

Apply continuous quality gates and complete a final release-readiness pass for the selected feature scope.

## Prerequisites

A declared release scope and candidate containing the selected outcomes from earlier phases.

## Work

1. Threat-model identity, authorization, privacy inference, import parsers, uploads, R2 delivery, exports and destructive commands.
2. Test authorization at every route, server action, queue consumer and workflow step; add CSRF/origin protections where applicable and secure response headers.
3. Fuzz/mutation-test GEDCOM parsing and enforce size/depth/count limits to prevent resource exhaustion.
4. Accessibility audit to WCAG 2.2 AA for navigation, editors, dialogs/drawers, graph alternatives, contrast, focus and reduced motion.
5. Performance tests with small, medium and agreed large trees; profile D1 reads/writes, pagination, graph layout and job memory/time.
6. Resilience tests for queue retries, duplicate delivery, workflow failure, migration interruption and concurrent edits.
7. Production observability: privacy-safe structured logs, error tracking, job alerts and operational dashboards.
8. Documentation: deployment, Access setup, role model, backup/restore, migration, import diagnostics, privacy behavior and collaborator guide.
9. Release migration rehearsal from the current prototype and rollback procedure.
10. Dependency/license review and removal of dead prototype paths.

## Validation matrix

Run repository `check`, `test` and `build` scripts in production-compatible configuration, targeted security/privacy tests, browser accessibility checks, restore rehearsal and smoke tests against both a fresh deployment and upgraded prototype snapshot.

## Parallel work

Security, accessibility, performance and operational documentation can run in parallel against a release candidate. Findings return to owning phases; this phase does not hide unresolved correctness defects.

## Exit criteria

- No known critical/high security or privacy issue remains.
- Core workflows meet WCAG 2.2 AA or have documented, approved exceptions.
- Defined scale tests meet recorded budgets with no whole-tree API dependency.
- Backup/restore, migration rollback and failed-job recovery are rehearsed.
- Fresh deployment and prototype upgrade both pass smoke tests.
- User/admin documentation matches shipped behavior.
