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

Slice S10 (2026-10-02) closed items 8 and 9 and settled `place_ref` (ADR-018); slice S11 added place records, rename and merge (ADR-019). Slice S5 (2026-09-30) started this phase; slice S6 (2026-09-30) added person names; slice S7 (2026-10-01) added search, lists, recents and favourites. Every work item and exit criterion is met, so the roadmap shows Phase 3 as *Complete*; the caveats (writes still load the whole tree, phonetic search and non-ASCII folding) are noted in the rows and pass to Phase 8.

| Work item | Status | Evidence |
|---|---|---|
| 1. Tree, person and union routes | Met | `/trees/[id]`, `/people/[personId]`, `/unions/[unionId]`; `e2e/routes.spec.ts` |
| 2. Person page (names, vitals, facts, family, notes and evidence placeholders, change metadata) | Met | `PersonPageService` tests against the whole tree for every fixture person |
| 3. Union page (participants, events, children, chronology, warnings) | Met | `UnionPageService` tests, `e2e/routes.spec.ts` |
| 4. Generic repeatable fact editor | Met | `fact-ops`, `fact-service` and `e2e/facts.spec.ts`; ADR-012 |
| 4a. Person names: several per person, GEDCOM round-trip, add/edit/reorder/remove/undo, "(née …)" display, optional from-date and partnership (S6) | Met | `names.test.ts`, `name-ops.test.ts`, `name-service.test.ts`, `name-display.test.ts`, `e2e/names.spec.ts`; ADR-013 |
| 5. Search by name variants, surname, place, dates, XREF; individual, union and surname lists | Met | `/trees/[id]/search` ranks every stored name, XREF, place and year range and says why; `/people`, `/unions`, `/surnames` page on the server (S7); `search-service.test.ts`, `list-service.test.ts`, `e2e/search-lists.spec.ts`. Phonetic search and non-ASCII folding wait |
| 6. Recent people, favourites, breadcrumbs, focus navigation | Met | Per-user, per-tree recents and favourites in D1 (ADR-014), in the tree strip, the focus box and the person page; `mark-service.test.ts`, `e2e/marks.spec.ts` |
| 7. Query-specific endpoints and measured indexes | Met for reads | Bounded graph, person, union, search and list endpoints; plans in `query-plans.md`; two name-order indexes added with numbers (S7). Writes still load the whole tree |
| 8. Relationship calculator | Met (S10) | `relationship-calculator.test.ts`, `kinship-service.test.ts`, `e2e/relationship.spec.ts`; ADR-017 |
| 9. Ancestor, descendant and interactive views on one graph-query layer | Met (S10) | The interactive tree runs on the window loader; the pedigree and descendant charts on the kin loader (`chart-service.test.ts`, `e2e/charts.spec.ts`) |

| Exit criterion | Status | Note |
|---|---|---|
| Common records are reachable in a few predictable actions from search or graph | Met | Search, the lists, the surname list, favourites and recents each link to the person page; graph to person is a double-click, the menu's Details or a link |
| Repeatable and conflicting facts are retained and displayed rather than overwritten | Met | Two births are both kept and flagged; editing one leaves the other; the person form flags that it edits only the first |
| Test corpora do not require a whole-tree response | Met for reads | A 4,000-person corpus; the window, person and union reads never call `loadRows`. Writes and the header counts are linear in the tree |
| Browser history, deep links and refresh preserve context | Met | `e2e/routes.spec.ts`, `e2e/history.spec.ts`; imported ids with `:` and `@` deep-link |
| Privacy placeholders are supported in DTOs | Met | `isPrivate` on every record DTO, always false (`shared/privacy.ts`) |

S7 deferred or departing from the plan: see the S7 status in [improvement-plan.md](./improvement-plan.md#s7-search-lists-recents-and-favourites) (linear-in-tree search cost, ASCII-only case folding, unsurnamed people first, recents not recorded on double-click refocus).

S6 deferred or departing from the plan: see the S6 status in [improvement-plan.md](./improvement-plan.md#person-names) (name lines stored on the name row, `_MARNM` unconfirmed, no migration of pre-S6 imports; the search UI gap was closed in S7).

Deferred or contradicting the plan: `depth=` became `up=`/`down=`; the unfocused `/graph` and `GET /api/trees/:id`
were removed in the architecture review (B3; `/graph` answers 400 without `focus`); fact history omits removed facts; old imported descriptions are not
backfilled into the new fact columns.
