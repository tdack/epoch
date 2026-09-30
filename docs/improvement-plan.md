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
| 1 | `place_ref` | Only a literal `place` text column exists. |
| 2 | Intent-based editor covering marriage, separation, divorce, death, end and remove | The modal offers only add parent, add child and add partner. The domain already has `record_death` and `end_union` intents that the UI doesn't expose. Union status and union events (marriage date and place) can't be edited. |
| 2 | Impact summaries for destructive actions; conflict display | Uses `window.confirm` and `window.alert` ([+page.svelte:331](../src/routes/+page.svelte)). No 409 conflict UI exists. `undoLast` exists server-side but has no UI. |
| 2 | Depth and relationship-type controls on the graph | Not built. |
| 2 | Never normalise away repeated unions | [PersonDrawer.svelte:66](../src/lib/components/tree/PersonDrawer.svelte) collapses unions by partner pair (commit `89cd0c2`). The real problem is duplicate FAMs from import, such as `The_Simpsons.ged`. See [Duplicate unions](#duplicate-unions). |
| 2 | Keyboard and screen-reader support | Nodes are focusable, but there is no arrow-key navigation, no text alternative to the graph and no focus management in the drawer. |

Phase 2 was reopened when this plan was written. It closed when slices S1–S4 below were done,
before Phase 3 starts.

After S4 the remaining Phase 2 gaps were closed and Phase 2 is *Complete*; see [phase-2-relationship-editor.md](./phase-2-relationship-editor.md#status-against-the-exit-criteria).
`place_ref` (Phase 1) is still open and belongs to Phase 3 places work.

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
