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

## Status against the exit criteria

Slice S5 (2026-09-30) started this phase. The rest is listed as waiting.

| Work item | Status | Evidence |
|---|---|---|
| 1. Tree, person and union routes | Met | `/trees/[id]`, `/people/[personId]`, `/unions/[unionId]`; `e2e/routes.spec.ts` |
| 2. Person page (names, vitals, facts, family, notes and evidence placeholders, change metadata) | Met | `PersonPageService` tests against the whole tree for every fixture person |
| 3. Union page (participants, events, children, chronology, warnings) | Met | `UnionPageService` tests, `e2e/routes.spec.ts` |
| 4. Generic repeatable fact editor | Met | `fact-ops`, `fact-service` and `e2e/facts.spec.ts`; ADR-012 |
| 5. Search by name variants, surname, place, dates, XREF; individual, union and surname lists | Waiting on a later slice | Only the existing name search |
| 6. Recent people, favourites, breadcrumbs, focus navigation | Partly | Breadcrumbs and a remembered focus exist; recents and favourites wait |
| 7. Query-specific endpoints and measured indexes | Met for reads | Bounded graph, person and union endpoints; plans in `query-plans.md`; no index needed. Writes still load the whole tree |
| 8. Relationship calculator | Waiting on a later slice | |
| 9. Ancestor, descendant and interactive views on one graph-query layer | Partly | The interactive tree runs on the window loader; ancestor and descendant chart views wait |

| Exit criterion | Status | Note |
|---|---|---|
| Common records are reachable in a few predictable actions from search or graph | Partly | Graph to person is a double-click, the menu's Details or a link; there is no search-to-record path beyond the focus box |
| Repeatable and conflicting facts are retained and displayed rather than overwritten | Met | Two births are both kept and flagged; editing one leaves the other; the person form flags that it edits only the first |
| Test corpora do not require a whole-tree response | Met for reads | A 4,000-person corpus; the window, person and union reads never call `loadRows`. Writes and the header counts are linear in the tree |
| Browser history, deep links and refresh preserve context | Met | `e2e/routes.spec.ts`, `e2e/history.spec.ts`; imported ids with `:` and `@` deep-link |
| Privacy placeholders are supported in DTOs | Met | `isPrivate` on every record DTO, always false (`shared/privacy.ts`) |

Deferred or contradicting the plan: `depth=` became `up=`/`down=`; the unfocused `/graph` and `/api/trees/:id` still exist for tests
and go with their last consumer; fact history omits removed facts; old imported descriptions are not
backfilled into the new fact columns.
