# Phase 3 — Records, facts, search and navigation

## Objective

Make the correct graph useful as a daily genealogy application.

## Prerequisites

Phases 1–2 core model, commands and relationship read models.

## Work

1. Create dedicated tree dashboard, person, union/family and edit routes instead of one global page.
2. Person page: preferred/alternate names, vital summary, facts/events timeline, parents, partners, children, notes/evidence placeholders and change metadata.
3. Union page: participants, relationship events, children, chronology and warnings.
4. Generic repeatable fact editor with type, original/structured date, place literal/reference, value, cause/age, notes and ordering.
5. Fast tree-scoped search by name variants, surname, place, dates and XREF; add individual, family/union and surname lists.
6. Recent people, favorites, breadcrumbs and focus-person navigation.
7. Paginated/query-specific endpoints rather than loading the whole tree; add indexes based on measured queries.
8. Relationship calculator/path explanation as a read-only service and initial relationship view.
9. Baseline ancestor, descendant and interactive tree views sharing one graph-query layer.

## Migration and testing

Redirect old routes to stable deep links and remove legacy aggregate DTOs only after consumers migrate. Test repeated/conflicting facts, incomplete records and every Phase 1 graph. Add query plans and performance fixtures for representative tree sizes.

## Parallel work

- Person/union views using agreed query DTOs.
- Search/indexing and duplicate-result ranking.
- Date/place input components.
- Read-only graph queries and relationship-path service.

## Exit criteria

- Common records are reachable in a few predictable actions from search or graph.
- Repeatable/conflicting facts are retained and displayed rather than overwritten.
- Test corpora do not require a whole-tree response.
- Browser history, deep links and refresh preserve context.
- Privacy placeholders are supported in DTOs even before Phase 4 policies are complete.
