# Improvement plan: gap analysis and tree rendering (2026-09-29)

This plan compares the running app with [roadmap.md](./roadmap.md), the phase documents and the
webtrees capability baseline. It proposes an ordered set of small, commit-sized slices. Every
finding below was verified against the code or the running app, using `The_Simpsons_clean.ged`
imported into local D1.

## Summary

- **The tree view is the weakest part of the product.** It has correctness bugs, not only
  cosmetic ones: partners go missing, partner lines span generations, and edges are duplicated.
  The layout algorithm is a placeholder (x = insertion order). It needs replacing, not tuning.
- **The roadmap overstates progress.** Phases 0–2 are marked Complete, but several of their exit
  criteria are not met (see [Roadmap reality check](#roadmap-reality-check)). Phase 2 has been
  reopened, and it has since closed (S1–S4 are done and verified; see the status line below).
- **Most webtrees capabilities are already assigned to Phases 3–7.** The gaps that no phase covers
  are narrower: siblings and relatives views, pedigree collapse, fitting charts to the screen, a
  person page as the primary navigation surface, and developer onboarding.

## Fix now

### F1. Harden the Access dev bypass

[hooks.server.ts:28-31](../src/hooks.server.ts) enables the dev bypass when
`process.env.NODE_ENV !== 'production'`. When the bypass is on, a request with no token becomes
the dev user, and [access.ts:149](../src/lib/server/auth/access.ts) accepts unsigned `alg: none`
tokens with any `sub`.

- The current deploy bundle is safe. `wrangler deploy --dry-run` shows esbuild inlines the check as
  `ACCESS_BYPASS_DEV === "true" || false || ...`.
- It is still fragile. Safety depends on a bundler define, and the unbundled Vite server output
  keeps the runtime `process.env` check. Any other build path, preview mode or bundler change
  silently makes production fail-open.
- **Fix:** enable the bypass only when `ACCESS_BYPASS_DEV === 'true'` is set explicitly, and
  accept `alg: none` only under that same flag. Add a test that production configuration rejects a
  tokenless request and an `alg: none` token.

### F2. Make a fresh clone runnable

- `npm run dev` on a fresh clone returns 500 (`no such table: users`) until you run
  `npm run db:migrate:local`.
- [README.md](../README.md) is still the `sv` boilerplate.
- **Fix:** document setup (Node version, `db:migrate:local`, dev identity, seeding a fixture). Add
  an `npm run seed` script that imports `docs/The_Simpsons_clean.ged` and the
  [genealogy fixtures](../src/lib/server/fixtures/genealogy-fixtures.ts).

## Tree rendering

### Observed problems

A probe that ran the layout for every person as focus on the Simpsons tree found the following:

| Symptom | Evidence |
|---|---|
| Descendants' partners are dropped | Focusing Jessica omits Rosalind Fairfax (Ned's partner). Focusing Homer or Marge omits Maude Flanders. The union node is drawn with one partner. |
| Partner lines span generations | In the unfocused view, a partner with no recorded parents is placed in generation 0. Maude is drawn two rows above Maggie. 2 of 6 unions are split this way. |
| Tangled edges | People are placed left to right in insertion order. Partners are not adjacent, children are not under their parents, and there is no crossing reduction. |
| Duplicate stacked edges | Each per-parent assertion produces its own curve from the same union node to the same child. Hannah appears twice in the union's children, so two identical curves are drawn, and selecting "the" line deletes only one parent's assertion. |
| No siblings or step-family in focus view | Focusing Bart shows 4 people. His siblings and Jessica's children (his step-children) are hidden. |
| Zoom buttons do nothing | After one Zoom In click, scale went from 0.220954 to 0.220955, with `requestAnimationFrame` running normally. The d3 transition is cancelled almost immediately. Mouse-wheel zoom works. |
| Initial view not fitted | The initial view is a fixed `translate(w/2, 120) scale(0.85)`, so most of the tree starts off-screen. |
| Cards unreadable when zoomed out | Cards render full text at every scale. At about 0.2 scale they are illegible slivers, and there is no simplified rendering for low zoom. |
| Legend and palette | Sex is shown in green and orange, and parent-child types use a similar teal and amber. Relationship colours compete with sex colours. The legend does not explain union status or deceased markers. |

### Root causes

1. **Included unions don't bring their partners.** Both BFS loops in `selectFocusedGraph`
   ([neutral-graph-layout.ts:111-129](../src/lib/components/tree/neutral-graph-layout.ts)) call
   `includedUnions.add(pc.unionId)` without adding that union's other partners. Only the focus
   person's own unions add partners (line 132). The fix is one rule: when a union is included,
   include all its partners, or a stub for each.
2. **Generation assignment ignores partnerships in the unfocused view.** Lines 195–218 seed
   generation 0 for every parentless person and propagate only parent to child.
3. **Horizontal placement is a counter.** Line 255 increments a counter per generation. No
   ordering, grouping or centring is applied.
4. **The union y-position is averaged.** Lines 279–280 average the y-positions of partners that
   may sit in different generations, which puts the union node between rows.
5. **Edges are emitted per assertion, not per visual relationship.** Line 308 emits one edge per
   `(parent, child)` assertion rather than one per `(union, child)`.
6. **The existing test encodes the bug.** The `selectFocusedGraph` test at
   [neutral-graph-layout.test.ts:101](../src/lib/components/tree/neutral-graph-layout.test.ts)
   asserts that `p2`, a partner of an included parent, is excluded. Change this test as part of
   the fix.

### Layout contract

Write these constraints as tests before changing the algorithm:

1. Every partner of every drawn union is drawn. When a depth limit or filter would hide someone,
   show a collapsed **"+N" stub** that expands in place rather than dropping them. This is the
   actual fix for "partners disappear at different depths."
2. Partners share a row, sit adjacent and have their union node between them. A person with several
   unions is placed between or beside their partners, in chronological union order.
3. Children are centred under their union, or under their parent for single-parent and direct
   links. Siblings stay contiguous.
4. There is one visual edge per `(union, child)`. That edge carries the set of per-parent types:
   solid when all parents are biological, and styled or labelled otherwise. Selecting it opens a
   popover listing the underlying assertions to edit or remove individually.
5. Repeated unions between the same pair remain distinct nodes, never merged.
6. Pedigree collapse (the same ancestor reached twice) renders once. Extra paths appear as a
   dashed link or an "also appears as" badge, never as a duplicate card.
7. Nodes never overlap, and edge crossings are at or below the recorded baseline for each fixture.

### Design direction

- **Start fresh.** Nothing is deployed in anger, so the existing layout module, its output
  contract (`NeutralGraphLayout`) and the canvas can all be replaced. Carry over only the
  behaviours worth keeping: the context menu, drag-to-relate, link selection and deletion. Design
  the new layout output around the contract above, not the old shape. A layout library is allowed
  where it clearly wins, but no library is required for the focus view.
- **Default view: a focus-centred hourglass.** This is the tree's default view. There is always a
  focus person: the last-viewed person, else the tree's home person, else the first person. It is deterministic and handles almost every
  real-world interaction. It shows:
  - ancestors above, as a pedigree with both parents per union;
  - the focus row: the focus person, their partners in union order, and their siblings (toggle);
  - descendants below, with every descendant's partner shown beside them.

  Place the rows with a simple tidy-tree pass: the ancestor half and descendant half are each
  trees once partners are grouped into "couple blocks". This yields clean, stable layouts that
  can be tested exactly.
- **Whole-tree overview: time-boxed spike.** Treat this as a spike, not a decision. Evaluate a
  layered (Sugiyama-style) engine that treats unions as dummy nodes:
  - [d3-dag](https://github.com/erikbrinkman/d3-dag) or ELK's `layered` algorithm, run in a web
    worker;
  - compare against the hourglass on the fixtures by crossings, width and runtime.

  Families with many cross-links (remarriage chains, cousin marriages) are where the hourglass
  breaks down.
- **Level of detail by zoom.**
  - Above 0.6×: full card (name, life dates, place, photo).
  - 0.3–0.6×: name and years.
  - Below 0.3×: a coloured block with the surname initial.
  - Keep hit targets usable at every level.
- **Viewport.**
  - Fit to content on load and after a focus change, animating to the new focus.
  - Fix the zoom buttons.
  - Add a minimap for large trees.
  - Add keyboard navigation between related nodes: arrow keys follow parent, child and partner.
- **Controls.**
  - Ancestor and descendant depth steppers (the options exist but have no UI).
  - Toggles for siblings, step relationships and relationship types.
  - A focus-person search box.
  - Put these in the URL (`?focus=…&up=3&down=2`) so views can be deep-linked.
- **Visual language.**
  - Cards show sex with a symbol (♂, ♀, and a neutral marker for `X` and unknown) and a
    muted pastel fill: soft blue for M, soft pink for F, warm neutral grey for X and unknown.
    Keep text contrast at WCAG AA or better on every fill. Suggested starting tokens:
    `--sex-m: #dbe8f5`, `--sex-f: #f6dde6`, `--sex-u: #ebe7e0`, each with a slightly darker
    border in the same hue.
  - Parent-child relationship types avoid blue and pink so they don't read as sex. Use line style
    first and a muted non-blue, non-pink hue second:
    - biological: solid, dark neutral;
    - adoptive: long dash, muted green;
    - foster: short dash, muted amber;
    - guardian: dotted, slate;
    - unknown: dotted, light grey.
  - Union status is shown on the partner connector: solid for active, dashed with an end marker
    for separated, divorced, annulled or ended.
  - Deceased is shown by a † and dates, not the word "deceased".
  - The legend explains sex symbols, line styles and union status.
- **Server-side scoping.**
  - Add `GET /graph?focus=&up=&down=` that returns the bounded subgraph plus stub counts.
  - The client no longer needs the whole tree. This is a Phase 3 exit criterion, and it keeps the
    layout cost bounded.

### Acceptance tests

Turn the probe into Vitest suites over `The_Simpsons_clean.ged` and every scenario in
`genealogy-fixtures.ts`, with **every person as focus** at several depths. Assert the following:

- No union is drawn with a missing partner unless that partner is represented by a stub.
- Partners are adjacent and share y. Each union sits between its partners.
- No card bounding boxes overlap.
- There is one visual edge per `(union, child)`.
- Crossing counts do not regress from the recorded baseline.
- Repeated unions and single-parent groups survive.
- Output is deterministic: the same input gives the same coordinates.

Add a Playwright visual smoke test that loads the fixture tree, focuses three people and takes
screenshots.

## Roadmap reality check

| Phase | Claim | What the code shows |
|---|---|---|
| 0 | Remove runtime schema creation | `ensureDbSchema` is still called from 12 API route handlers and the GEDCOM importer. It runs a hand-maintained `CREATE TABLE IF NOT EXISTS` baseline ([schema-init.ts](../src/lib/server/db/schema-init.ts)) once per isolate. That is a second schema source that can silently drift from `drizzle/` migrations. |
| 0 | Break up the one-page UI into route-level screens | Everything lives on [+page.svelte](../src/routes/+page.svelte) (608 lines) plus modals. There are no person, union or search routes. |
| 0 | Correlation IDs, typed errors | Present. Handlers still repeat try/catch and `DomainError` mapping in every route, so a shared `handleError` helper would help. |
| 1 | ADR-004 dates with bounds, precision and qualifier | [date-value.ts](../src/lib/shared/date-value.ts) parses these, but `events` stores only `date_raw` and `date_sort`. The bounds, precision and qualifier are discarded at persistence. |
| 1 | Neutral sex marker | The graph domain uses `'X'`, but `individuals.sex` allows only `M`, `F` and `U`. |
| 1 | `place_ref` | Departure, recorded in ADR-018 (S10): no stored reference. A place is the fact's own text, grouped without regard to case, with a places list, a place page and editor suggestions. |
| 2 | Intent-based editor covering marriage, separation, divorce, death, end and remove | The modal offers only add parent, add child and add partner. The domain already has `record_death` and `end_union` intents that the UI doesn't expose. Union status and union events (marriage date and place) can't be edited. |
| 2 | Impact summaries for destructive actions; conflict display | Uses `window.confirm` and `window.alert` ([+page.svelte:331](../src/routes/+page.svelte)). No 409 conflict UI exists. `undoLast` exists server-side but has no UI. |
| 2 | Depth and relationship-type controls on the graph | Built (the toolbar's generation steppers and link-type checkboxes, kept in the address); proved in S10 by `e2e/controls.spec.ts`. The row said "not built" after they were. |
| 2 | Never normalise away repeated unions | [PersonDrawer.svelte:66](../src/lib/components/tree/PersonDrawer.svelte) collapses unions by partner pair (commit `89cd0c2`). The real problem is duplicate FAMs from import, such as `The_Simpsons.ged`. See [Duplicate unions](#duplicate-unions). |
| 2 | Keyboard and screen-reader support | Nodes are focusable, but there is no arrow-key navigation, no text alternative to the graph and no focus management in the drawer. |

Phase 2 was reopened when this plan was written. It closed when slices S1–S4 below were done,
before Phase 3 starts.

After S4 the remaining Phase 2 gaps were closed and Phase 2 is *Complete*; see [phase-2-relationship-editor.md](./phase-2-relationship-editor.md#status-against-the-exit-criteria).
`place_ref` (Phase 1) was settled in S10 by ADR-018, which has no stored reference; hierarchy, merging and maps stay Phase 7.

### Duplicate unions

**The problem.** In `The_Simpsons.ged`, many of the 10 `FAM` records are copies:

- Homer and Marge's family appears three times in full, plus once with only Homer and once with
  only Marge. Bart has three `FAMC` links, one to each full copy.
- Bart and Jessica's family appears twice.

The importer correctly creates one union per `FAM`, so the tree gets several identical
Homer–Marge unions.
Commit `89cd0c2` hides the empty copies in the drawer only. The canvas still draws every copy, and
the data stays duplicated.

The model must still allow two genuinely separate unions between the same pair, such as a divorce
followed by remarriage. So the app can't treat "same partners" as "same union".

**Direction:**

1. **At import, detect exact duplicates.** Two `FAM` records are exact duplicates when they have
   the same partner set and no conflicting union facts. "No conflicting facts" means both have
   none, or the facts are identical. List these in the import preview under "Duplicate families"
   with a default-on option to merge them. Merging unions their children and keeps every
   original XREF as an alias, so export can still reproduce them. Families with the same partners
   but different facts (for example, two marriage dates) are never merged automatically. The same
   applies to a single-partner `FAM` whose partner and children are a subset of a full family.
   Both kinds are listed as "possible duplicates" for you to review.
2. **For existing data, add a merge-unions command.** Add an explicit command with a preview,
   used from the union context menu and the person drawer. This is the union counterpart of Phase
   5's person merge, and it is needed now.
3. **Remove the drawer dedupe.** The drawer and the tree then show exactly what is stored. Two
   unions between the same pair are labelled by chronology ("1st partnership", "2nd
   partnership", with dates where known) so the repetition reads as intentional.

## webtrees capability map

| webtrees capability | Owning phase | Current state |
|---|---|---|
| Individual page (facts, relatives tabs, sources, notes, media) | 3 | Drawer shows birth and death, families and media only |
| Family page | 3 | None |
| Edit any fact or event, add name variants | 3 | Birth and death only; name variants modelled but not editable |
| Interactive tree, pedigree, descendancy, hourglass | 2/3/6 | One canvas (see above) |
| Fan, compact, family book, timeline, lifespan charts | 6 | None |
| Relationship chart ("how are X and Y related") | 3/6 | None. `relationship-sentence.ts` is the save-preview sentence, not a path calculator. |
| Lists: individuals, families, surnames, places | 3 | None; search endpoint only |
| Search: general, advanced, phonetic (Soundex/DM) | 3 | Basic name search |
| Sources, repositories, citations, shared notes | 5 | No tables |
| Find duplicates, merge records | 5 | None; also needed for duplicate unions |
| Check-tree / data-quality report | 5 | None |
| Research tasks (`_TODO`) | 5 | None |
| Privacy: living people, restrictions, relationship privacy | 4 | No living-state or privacy fields |
| Pending changes, moderation, change history | 4 | No audit table |
| Members, invitations, roles UI | 4 | Roles in DB; no UI |
| Media objects, galleries, highlighted image | 7 | Upload and attach only |
| Places hierarchy, maps, pedigree map | 7 | Literal text only |
| Reports (family group, individual, ancestors, descendants) | 6 | None |
| Anniversaries, calendar, recent changes, statistics | 6 | Counts banner only |
| Clippings cart / branch export | 6 | Whole-tree export only |
| GEDCOM import validation, preview, export | 1/6 | Preview and import exist; large-file queue path exists |
| Favourites, recent people, home dashboard | 3 | None |

**Gaps no phase covers:**

- **Siblings, half-siblings and step-relatives views.** Add these to Phase 3's person page and to
  the tree's focus row.
- **Pedigree collapse and implex handling in charts.** Add this to Phase 2 layout and Phase 6
  charts.
- **Level-of-detail rendering and fit-to-view for large trees.** Add to Phase 2 and Phase 8
  performance work.
- **Developer onboarding and seed data.** Add to Phase 0 or 8.
- **A merge command for duplicate unions** imported from dirty GEDCOM. Phase 5 owns person merge.
  Union merge is needed earlier, because it replaces the drawer workaround.

## Delivery slices

Each slice is one or a few commits with its own tests. Run slices in order. Slices with the same
number prefix can overlap.

| # | Slice | Outcome |
|---|---|---|
| S0 | Security and onboarding | F1 bypass hardening with tests; README; `seed` script. |
| S1a | Layout contract tests | Write the layout contract as Vitest suites against the new module's API, over the Simpsons fixture and `genealogy-fixtures.ts`, with every person as focus. Delete the old layout tests along with the old module. |
| S1b | Focus subgraph selection | New pure selection function: every partner of a drawn union is included, "+N" stubs at depth limits, siblings toggle, pedigree collapse detected. |
| S1c | Hourglass placement engine | New from-scratch layout: couple blocks, children centred, one edge per `(union, child)`, deterministic output. Contract tests pass. Old `neutral-graph-layout.ts` removed. |
| S1d | New canvas | New tree canvas: sex symbols and pastel fills, line-style relationship types, union status connectors, working zoom buttons, fit-to-content, level of detail by zoom, animated refocus, legend. Carries over the context menu, drag-to-relate and link deletion. The old canvas is removed. |
| S1e | Graph controls and URL state | Always-focused default view; depth steppers, relationship-type and step toggles, focus search, deep-linkable view. |
| S1f | Overview spike | Time-boxed d3-dag/ELK comparison on fixtures for an optional whole-tree overview; decision recorded in `decisions.md`. |
| S2 | Editor completion (done) | Expose `record_death`, `end_union`, union status and marriage/partnership events; replace `confirm`/`alert` with an impact-summary dialog; undo toast using `undoLast`; 409 conflict dialog. |
| S3 | Duplicate unions (done) | Import-time exact-duplicate detection and merge in the preview; merge-unions command with preview; remove the drawer dedupe; chronological labels for repeated unions. See [Duplicate unions](#duplicate-unions). |
| S4 | Phase 0/1 debt (done) | Removed `ensureDbSchema` and `schema-init.ts` (migrations are the only schema source; a missing schema answers 503 with the command to run; a test fails if Drizzle and the migrations disagree). Persisted date bounds, precision and qualifier (migration 0007, `dateColumnsFor`, backfill script; ADR-004 addendum). `X` sex end to end, with a documented 5.5.1 fallback (ADR-010). One `errorResponse` helper for every route. Also: explicit union choice on add child, add parent and add partner (the S2 gap), alias-aware merge-mode re-import (ADR-008), and `FAMC` extras kept through export (ADR-009). |
| S5 | Phase 3 start (done) | Routes `/trees/[id]`, `/trees/[id]/people/[pid]`, `/trees/[id]/unions/[uid]` with the old `/?tree=` address redirecting; person and partnership pages; a repeatable fact editor; the bounded `/graph?focus=` endpoint (`up`/`down` in place of `depth`), proved equal to the whole-tree layout. See ADR-011 and ADR-012 and [query-plans.md](./query-plans.md). |
| S6 | Person names (done) | Every `NAME` round-trips through GEDCOM (type, `NPFX`/`GIVN`/`NICK`/`SPFX`/`SURN`/`NSFX`, extra lines, legacy `_MARNM`); add, edit, reorder, remove and choose the preferred name through the mutation runner with previews and undo; "Jessica Wren (née Lovejoy)" on cards, drawer, person page, summaries, previews and sentences; search matches every name; an optional from-date and partnership on a name, kept in a `NOTE` under the `NAME`. See ADR-013, [Person names](#person-names) and [s6-person-names-prompt.md](./s6-person-names-prompt.md). |
| S7 | Search, lists, recents and favourites (done) | A ranked tree search (any name, surname, nickname, XREF, place, year range) that says why each person matched, at `/trees/[id]/search`; people, partnerships and surnames lists paged on the server; per-user favourites and recents in D1 (ADR-014); measured plans and two name-order indexes (migration 0010). See [S7 status](#s7-search-lists-recents-and-favourites). |
| S8 | Privacy foundation (done) | Living-state derivation, a per-person override, one viewer scope, a visibility predicate in the search, list and record queries, "Private" placeholders, guarded writes, role-gated export and media, no auto-ownership. See ADR-015 and [S8 status](#s8-privacy-foundation). |
| S9 | Members and invitations (done, deployed 2026-10-02) | Invite an email address, take it up on sign-in, change roles and remove members, last owner protected, creators keep sight of their own people. See ADR-016 and [S9 status](#s9-members-and-invitations). |
| S10 | Kinship, charts and places (done, deployed 2026-10-02) | A relationship calculator reporting every route, pedigree and descendant charts, the depth and link-type controls proved, and places as the text on a fact. See ADR-017, ADR-018 and [S10 status](#s10-kinship-charts-and-places). |

After S5, continue with Phases 3–7 as written. Phase 4 (privacy) must land before sharing the tree
with any collaborator. The current model has no living-person protection.

### Person names

Raised 2026-09-30 while using S5. `person_name` already models type, components, preferred flag and
order, but only one name per person survives GEDCOM import and export (extra `NAME` records are
dropped), and nothing in the UI edits names. That is a round-trip bug against the architecture's
"no loss" rule as well as a missing feature.

What the standard does: a person may have several `NAME` records, each with a `TYPE` (5.5.1: aka,
birth, immigrant, maiden, married; 7.0 adds professional and other). GEDCOM has no date on a
`NAME`, so when a name changed has no standard home; webtrees likewise lists names and leaves the
date to the marriage event or a note. Legacy programs write `_MARNM` for a married name.

Decision for S6: keep every name; add an optional "from" date and an optional partnership link on
a name in Epoch's own columns, and export them as a `NOTE` under the `NAME` so nothing is lost on a
round trip. The display name follows the preferred name. Full scope, non-goals and process rules
are in [s6-person-names-prompt.md](./s6-person-names-prompt.md).

**S6 status (2026-09-30): done.** Departures from this plan and things left open:

- **Preserved `NAME` sub-structures are stored on the name row** (`gedcom_extra`), not in `gedcom_preserved` as the plan and the hand-off prompt said (ADR-009's mechanism). That table is keyed by the owner's XREF and a head line, which a name does not have, and it is outside the row-operation tables, so deleting or undoing a name could not have carried its `NOTE` or `SOUR`. The mechanism is the same; see ADR-013.
- **`_MARNM` is not confirmed against webtrees.** Its `Individual.php` does not mention the tag, so the reading rests on the prompt's recollection: level 1 on the `INDI`, either `Given /Surname/` or a bare surname. A level-2 `_MARNM` under a `NAME` is kept as an extra line, not modelled.
- **People imported before S6 have one name.** The old importer dropped the others; re-importing the file in replace mode brings them back. Nothing was migrated.
- **A person created before S6 in the editor has no name row.** The first name command gives them one; until then the page shows their fields as the only name and says to edit it from the person form.
- **Stale pre-S6 name rows** (the old person form edited `individuals` only) are read as the person's own fields on export and on the person page; nothing is backfilled, and the local database has none. See ADR-013.
- **The last name of a person cannot be deleted**, so there is always a preferred name to mirror.
- **Search UI:** the API returns `matchedName` (the stored name a person matched through) but the focus box and the relationship dialog do not show it yet, so a hit on an old name lists the current one.
- **Not built (out of scope by the prompt):** phonetic and surname-list search, the search page, privacy for names, `FONE`/`ROMN` modelling (they are kept as extra lines).
- **Known round-trip losses:** a `NAME` line that disagrees with its `GIVN`/`SURN`, or carries a quoted nickname, comes back in canonical form (ADR-013). `union-choice.spec.ts` is a pre-existing flake: it failed 1 of 8 runs on the S5 merge commit and 1 of 4 on this branch.
- **Known cosmetic limit:** a card truncates the name at 22 characters, so a long given name loses its end before the "née" line.

### S7: search, lists, recents and favourites

**S7 status (2026-10-01): done.** What shipped, and where it departs from the plan:

- **Search.** One tree-scoped query ranks every stored name and each person's display name in SQL before `LIMIT` (exact, whole word, prefix, word start, substring; displayed name over preferred over other names; stable tie-break), so a one-letter query keeps its exact match under a limit. It also takes an XREF (`@I4@`, `I4` or `i4`), a place substring and a year range. Every result carries `matches[]` saying which name, XREF or fact matched. The page is `/trees/[id]/search` (`?q=&place=&from=&to=&offset=`); the focus box and relationship dialog now say "also known as …".
- **Place and dates hold on the same fact**, and a partnership's fact (a marriage place) reaches both partners. A fact with no date never matches a date range; `BEF`/`AFT` are open on one side, so `BEF 1900` overlaps 1850–1900. Dates are read from the stored bounds, never re-parsed.
- **Lists.** `/trees/[id]/people` (sort by surname or given name, optional `?surname=`), `/unions` and `/surnames`, all server-paged (50, offset). A surname's count equals the rows of its filtered list (tested). None calls `loadRows` (tested with a spy).
- **Recents and favourites.** D1 rows per user and tree (ADR-014), shown in a strip under the tree nav, in the focus box before typing, and with a toggle on the person page. A recent is an explicit `POST` from the page, never a load (`app.html` preloads on hover).
- **Measured, not guessed** ([query-plans.md](./query-plans.md)). Two trees in one database so a cross-tree scan shows: the first partnership-fact branch read 951,241 rows to answer a 419-person tree; the first XREF lookup read the whole tree. Both fixed in the query. No search index was added. Two expand-only indexes were added for the individuals list (10,648 rows read per page without them, 51 with); a `person_names` surname index was rejected because it reads other trees.
- **Privacy hooks.** (The seam filters after SQL has chosen the page, so Phase 4 can mask rows there but cannot correct `hasMore`, page fill or surname counts; the real filter must move into the queries.) Every new DTO carries `isPrivate` (`privacyOf`), and search, lists and marks all passed through `filterForViewer` (`services/privacy-seam.ts`; removed in S8, which put the rule in the queries). What would leak under Phase 4 is listed at the top of that file: the `matches` text (a private person's married name or place), search totals and `hasMore`, surname counts, partner names on the partnership list, and ordering.
- **`searchPeople` was replaced**, not kept: the repository class is gone; `people-search` keeps its response shape, and the duplicate cue uses `SearchRepository.find`.

Left open or departing from the plan:

- **Search is linear in the tree's people per query** (about 4–8 rows read per person) and offset pages are linear in the offset (never more than the tree). The surname list and a surname filter read about 6.5x and 3.2x the tree's people. Acceptable at this phase's sizes; Phase 8 decides counters or a normalised name column.
- **Events written before ADR-004's date columns** (a `date_raw` with no `date_sort`) can never match a year range, because the filter reads only the stored bounds. The local database has none (`select count(*) from events where date_raw is not null and date_sort is null` is 0); a deployed one may, and `npm run db:backfill:dates -- --remote` fills them.
- **ASCII-only case folding.** SQLite `LIKE`, `lower()` and `collate nocase` fold only ASCII, so "müller" does not match "Müller". Needs a normalised column (with the phonetic work).
- **Unsurnamed people sort first** in the individuals list (an expression in `ORDER BY` would lose the index).
- **Recents are recorded on the person page and on a focus-box pick only**, not when the tree refocuses by double-click.
- **Marks for people deleted for good are not pruned**; they are simply not shown. Marks are not in a GEDCOM export.
- **Keyed by `users.id`, not the raw Access `sub`**, which is the same identity one hop along (ADR-014).
- **Not built (out of scope by the prompt):** phonetic search, boolean query syntax, place hierarchies, the relationship calculator, pedigree/descendancy charts, source/note search, saved searches, privacy policy.

### S8: privacy foundation

**S8 status (2026-10-01): done, merged and deployed 2026-10-02 (migrations 0012 to 0014 applied remotely, owner check clean).** Phase 4 items 3, 4, 5 (people, facts, partnerships), 6 and the read side of 10. See [ADR-015](./decisions.md), [s8-privacy-foundation-prompt.md](./s8-privacy-foundation-prompt.md) and [query-plans.md](./query-plans.md#visibility-s8-adr-015).

- **Who is private.** A person with a death, burial or cremation fact, or whose latest birth or baptism upper bound is before a cutoff, is not living. The cutoff is 120 years by default, set per tree, computed from an injected `now`. Anyone else, including anyone with no dated fact, is private. `individuals.privacy` (`auto`/`public`/`private`, migration 0012) overrides it; `RESN privacy|confidential` imports as `private` and exports back as `RESN privacy`, and `public` travels as `_EPOCH_PRIVACY public`.
- **Where it is decided.** One `ViewerScope` per request (`requireTreeScope`); owners, managers and editors see everyone, contributors and viewers do not. The paged reads carry a visibility predicate beside `tree_id`, so totals, `hasMore`, page fill, surname counts and order are computed over what the viewer may see. The reads that load rows mask them (`maskRows`), and the focus window never loads a private person. `filterForViewer` is gone.
- **Absent, not masked.** A private person is excluded from search, lists, favourites and the header counts, and answers exactly like a missing id (tested). Placeholders ("Private", dashed card, nothing clickable) appear only in the graph and the family lists of a page, when the tree setting is on (default off).
- **Writes.** A contributor's command is planned over the rows they can see (so a private id fails as a missing one does), then over every row, and refused if it would touch a private person. Previews need the rights of the change.
- **Closed doors.** Export is a manager action and so is its background job (re-checked in the workflow). Media reads check the tree and the record, `Cache-Control` is `private`, uploads need an editor and a record of this tree. The first caller no longer becomes owner of a tree with no members. `GET /api/trees/[id]`, `GET .../individuals/[id]` and the tree-wide change log need an editor.
- **Manager UI.** A privacy panel on a person's page, a Privacy page for the tree, the Privacy link and the Export button only for managers.
- **Tested.** Pure rule matrix, SQL/pure parity, search, lists, favourites, graph, person and partnership pages, writes, media, export, ownership, a route-driven matrix that fails when an endpoint or page load has no entry, GEDCOM round trip, and `e2e/privacy.spec.ts` as a real second identity.

Left open or departing from the plan:

- **Deployed 2026-10-02.** Migration 0012 is now applied remotely. The preconditions were: every tree must have an owner (the old request-time grant is gone, so a tree with no member is unreachable); `select t.id from trees t where not exists (select 1 from tree_memberships m where m.tree_id = t.id and m.role = 'owner')` must return nothing remotely.
- **A contributor's new living person disappears from their own view** until a manager gives a death or a birth date, because uncertain means private. The create forms take dates, but a person added with none is hidden from the person who added them.
- **Editors see everyone.** An editor can change any record, so hiding one from them only hides what they can already alter. Say if editors should be restricted.
- **A partnership with any private partner is hidden from a restricted viewer** along with its marriage facts: gone from the lists, the person page and the graph when private people are omitted, and shown with its partners as placeholders and no facts when they are not. A contributor naming such a partnership in a command is answered as if it did not exist.
- **History is withheld from a restricted viewer** (change summaries are prose that name people), and an undo refusal does not quote a later change.
- **Cost.** A restricted viewer's surname list reads about 12 rows per person (6.5 before); the partnership list's first page reads 650 rows instead of 51. The stored-column alternative in ADR-015 is the next step if a tree outgrows it.
- **`confidential` exports as `privacy`.** The word is not kept; both mean private to Epoch.
- **Not built:** member invitation and administration (Phase 4 item 1), suggestions and approval (8), audit and history UI (7, 9), a filtered export for lesser roles, media privacy beyond following the person, notes and citations (they do not exist yet).
- **Dev identity:** `ACCESS_BYPASS_DEV` also reads the dev identity from a cookie, because a page's server render forwards cookies and not custom headers; still only with the flag on.
- **Flake:** `undo-and-conflict.spec.ts` "a concurrent edit opens the conflict dialog" failed once in the full run and passed on rerun; not confirmed against the baseline.

### S9: members and invitations

**S9 status (2026-10-01): done, merged and deployed 2026-10-02.** Phase 4 item 1, and two decisions about S8. See [ADR-016](./decisions.md).

- **Decided about S8:** editors keep seeing everyone; a contributor sees the people they created while they are private (`individuals.created_by`, migration 0013), and a manager's `private` still hides them.
- **Members screen** (managers and owners): invite an address with a role, see the offers waiting (with expiry), withdraw one, change a member's role, remove a member with a confirmation.
- **Rules** (`shared/membership-policy.ts`, `services/member-service.ts`): a manager gives and acts on roles below manager only; an owner on any; the last owner can neither be lowered nor removed, enforced inside the statement; a stale version answers 409; only managers and owners can list members.
- **Taken up on every request,** by an indexed lookup (plan tested), so a second tree reaches a person already signed up.
- **Tested.** Policy table, the service (roles, expiry, case, second tree, concurrent owner demotion, next-request effect), the matrix test, and Playwright (invite and withdraw, the only owner cannot be lowered, and the viewer in `privacy.spec.ts` now arrives by invitation).

Left open:

- **Deployed 2026-10-02.** Migrations 0013 and 0014 are applied remotely, after the S8 ownership check (clean).
- **Cloudflare Access is separate.** The invited address must also be allowed by the Access policy; the app cannot edit it.
- **No audit of membership changes,** no invitation email (the manager tells the person), no "leave this tree", and no transfer wizard (an owner makes another owner and steps down).
- **Contributor-created people:** the creator test first leaked a private partner's partnership to contributors through three-valued logic (`null = x`); found by comparing a contributor's and a viewer's answers, fixed with `is`, and both shapes are now measured and compared in the plan tests.
- **Flake:** `union-choice.spec.ts` failed once in a full run and passed three times alone.

### S10: kinship, charts and places

**S10 status (2026-10-02): done, merged and deployed (version `f1e30f1c-0674-4759-8f90-56d1a4e5f4c0`, migration 0015 applied remotely).** Phase 3 items 8 and 9, Phase 2's depth and link-type controls (already built; now tested) and Phase 1's `place_ref` (by ADR-018, not as a column). See [ADR-017](./decisions.md), [ADR-018](./decisions.md) and [query-plans.md](./query-plans.md#kin-window-s10-relationship-pedigree-and-descendants).

- **Relationship calculator** (`/relationship?from=&to=`, `domain/relationship-calculator.ts`): every route between two people (the same person, a partnership, blood routes, routes by partnership), each with the people it runs through and any non-biological link named; "1st cousin once removed", gendered words when sex is recorded and neutral ones otherwise; masked for the viewer in memory, so a private person is absent or a "Private" step. Linked from the person page and the tree navigation.
- **Pedigree and descendant charts** (`/people/[id]/pedigree`, `/descendants`): SVG cards with dates, depth in the address (default 4, at most 8), a card leads to that person's chart, "more above or below" shown when a limit hid people. One bounded kin loader shared with the calculator (about 9 to 13 rows per person).
- **Places** (`/places`, `/place?name=`): the places a tree's facts name, counts, the facts at a place, a substring search, links from the person and partnership pages and place suggestions in the fact editor. No stored reference: ADR-018.
- **Tested.** The calculator table (labels, couples, double cousins, step routes, adoption), the services over a real database as owner, viewer and contributor in both placeholder modes, the matrix, the plans on the big tree, and Playwright (relationship, charts, controls, places).

Left open or departing from the plan:

- **No `place_ref` column** (ADR-018): no merge of spellings, rename across facts, hierarchy or maps; Phase 7.
- **Relationships through a private ancestor are hidden** from a restricted viewer when private people are omitted, with no sign they exist; with placeholders on they show as "Private".
- **Charts have no separate text outline**; the cards are links in a grouped SVG. A pedigree slot holds two parents (biological first); the person page lists all.
- **Descendants** list a person's children across partnerships together, in birth order.
- **Place list cost** is one pass over the tree's events, like the surname list.
- **Not built:** relationship paths longer than 20 generations or through more than 3,000 people say "stopped at its limit"; fan and hourglass chart styles; place-based search by hierarchy.

## Decisions (2026-09-29)

1. **Phase 2 was reopened** (2026-09-29) and is *Complete* again (2026-09-30).
2. **The default tree view is focus-centred.** It always centres on one person, using the
   hourglass layout. A whole-tree overview is optional, pending the S1f spike.
3. **The tree is rebuilt from scratch.** The layout module, its output contract and the canvas
   are all replaceable. A library may be adopted where it clearly wins, but the focus view is
   hand-written for determinism and testability.
4. **Duplicate unions are handled in the data, not hidden in the UI.** Exact duplicates are merged
   at import, with preview. Existing duplicates are merged by an explicit command. The drawer
   dedupe from `89cd0c2` is removed. See [Duplicate unions](#duplicate-unions).
5. **Cards show sex with a symbol and a muted pastel fill:** blue for M, pink for F, neutral grey
   for X and unknown. Relationship types use line style and non-blue, non-pink hues.
