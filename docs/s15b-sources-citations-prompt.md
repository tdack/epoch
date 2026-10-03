# Prompt: S15b, sources, repositories and citations

Hand this whole file to a fresh session.

---

You are working on Epoch (SvelteKit 3 / Svelte 5 / Cloudflare Workers + D1 with Drizzle), a
private family-tree app. Your job is slice **S15b**: turn the sources, repositories and citations
that S15a keeps as verbatim GEDCOM lines into real records. They must be modelled, shown beside
the facts they support, editable, privacy-aware and still lossless through GEDCOM 5.5.1 and 7.0.

This is Phase 5, items 1 to 4 and 9, for **sources, repositories and citations**. Shared notes as
records, and research tasks (item 8), are a later slice (S15c). Leave notes as they are now and
don't start S15c.

## Read first

- **`AGENTS.md`.** Follow it exactly:
  - layering: routes never touch the database;
  - boolean prefixes, which also apply to D1 columns by hand;
  - no `enum`;
  - comments explain why;
  - `Props` interfaces with TSDoc;
  - colocated tests;
  - expand-and-contract migrations;
  - small Conventional Commits with its commit trailer.
- **`docs/phase-5-evidence-quality.md`** (the objective and exit criteria) and
  **`docs/improvement-plan.md`** (the capability map and delivery-slice table).
- **`docs/decisions.md`:**
  - ADR-023 (S15a), all of it. Its last bullet is your brief: what S15b models moves out of the
    retained lines and into tables, and what it doesn't model stays where it is.
  - Also ADR-004 (dates), ADR-008 (merge-mode re-import and aliases), ADR-013 (name extras),
    ADR-015 (privacy), ADR-019 (places), ADR-021 (quality), ADR-022 (person merge), ADR-026 and
    ADR-027 (the shared person view).
- **GEDCOM code:**
  - `src/lib/server/gedcom/`: `parser.ts`, `serializer.ts`, `tags.ts`, `export-payload.ts`,
    `import-preview.ts`;
  - `evidence-roundtrip.test.ts` and `fixtures/evidence.ged`;
  - `src/lib/server/repositories/gedcom-repository.ts` and `gedcom-neutral-writer.ts`, and
    `src/lib/server/services/gedcom-service.ts`.
- **Schema:** `src/lib/server/db/schema/` (`gedcom.ts` holds `gedcom_preserved`, and `events.ts`
  holds `gedcom_extra`) and the latest migration in `drizzle/`.
- **How a write works:**
  - `services/mutation-runner.ts`, `domain/change-log.ts` and `domain/impact.ts`;
  - a worked example end to end: `domain/fact-ops.ts`, `services/fact-service.ts` and the facts
    endpoints;
  - `services/person-merge-service.ts` / `domain/person-merge.ts` and the union merge.
- **Privacy:** `repositories/visibility.ts`, `domain/privacy-mask.ts`, `services/privacy-*.test.ts`
  and `src/routes/privacy-matrix.test.ts`.
- **UI:**
  - `src/lib/components/person/`: `PersonView`, `PersonFacts`, `PersonEvidence` (today a
    placeholder fed by `PlaceholderDto`) and `PersonNames`;
  - `src/lib/shared/person-page.ts`;
  - `services/person-page-service.ts`;
  - the union page;
  - `src/lib/services/tree-api.ts`;
  - `src/lib/components/layout/TreeNav.svelte`.
- **Quality:** `domain/quality-checks.ts` and `services/quality-service.ts`.

Create branch `feat/s15b-sources-citations` from the latest `main`. The repo needs Node ≥ 24.

## The model

Decide the final shape after reading the code. Record it in an ADR. This is the starting point and
the constraints:

- **`source`:**
  - `id`, `tree_id`, `xref`, `version`, audit columns;
  - `title`, `author`, `publication`, `abbreviation`, `text`;
  - `gedcom_extra`, which holds every line with no column, verbatim and in order, as for events
    and names.
- **`repository`:**
  - `id`, `tree_id`, `xref`, `version`, audit columns;
  - `name` and an address kept as text;
  - `gedcom_extra`.
- **`source_repository`:** the source's `REPO` links, in order, with `call_number` and `gedcom_extra`
  (for `MEDI` and the like). A `REPO` with no pointer is legal; keep it.
- **`citation`:** one GEDCOM `SOUR` substructure in one place, so it is **owned by exactly one
  subject**, not shared:
  - `subject_kind`: person, name, event, union or parent-child. Use an `as const` object, not an
    `enum`.
  - `subject_id`, `sort_order`;
  - `source_id`, nullable for a 5.5.1 citation with no pointer, whose text then goes in
    `description`;
  - `page`, `quality` (`QUAY` 0 to 3, nullable), `entry_date` as a `date_value` (ADR-004), `text`
    (`DATA.TEXT`);
  - `gedcom_extra` for everything else (`OBJE`, `NOTE`, `EVEN`/`ROLE`, custom tags).

  Keeping imported citation order is an exit criterion.
- **Dangling pointers:** a citation of a source that isn't in the file stays importable and
  exportable. ADR-023 already proves this. Decide how it's held, for example a nullable `source_id`
  plus a retained pointer, and keep the test.
- **What stays in retained lines:** whatever you don't model. Notes (`NOTE`, `SNOTE`) and `OBJE`
  roots stay retained, and so do citations under anything not in `subject_kind`.

**Migration (expand only):**

- New tables and indexes in their own migration, one per logical change.
- Nothing is dropped or renamed. Don't remove `gedcom_preserved` or `gedcom_extra`; less goes into
  them from now on.

**Existing trees:** a tree imported after S15a holds its evidence as retained lines and event
extras. Add an idempotent backfill script, in the style of `scripts/backfill-event-dates.mjs`, that
moves the modelled lines into the new tables through the same mapping code as import.

- Prove it with a test: backfilling a tree imported the old way gives the same rows and the same
  export as importing fresh.
- Document running it in the README.
- If writing the backfill turns out to be unsafe, stop and explain rather than shipping a partial
  conversion.

## GEDCOM

- **Import** maps root `SOUR` and `REPO` records, and every `SOUR` citation under `INDI`, `NAME`,
  individual and family events, `FAM` and the child link (`FAMC` / the parent-child row). Map
  pointers through the same XREF and alias rules as people (ADR-008 and ADR-022).
- **Export** writes them back in both versions:
  - in their original position and order;
  - roots once each, after the people and families as now;
  - XREFs stable across exports.
- **`evidence-roundtrip.test.ts` must pass unchanged.** It is the contract that nothing is lost.
  Extend it; don't edit its expectations.
- **Add tests for:**
  - a GEDCOM 7 file with citations;
  - citation order kept;
  - `QUAY` and `DATA.DATE` with an approximate date;
  - a pointerless citation;
  - a second export identical to the first;
  - replace and merge re-imports changing nothing;
  - a citation following a fact through edit, person merge, union merge and undo.
- **Merge-mode re-import** (ADR-008) must not duplicate sources, repositories or citations. Define
  their identity:
  - sources and repositories: XREF or alias;
  - citations: owner, source, page and text.

  Test it.

## Writes and services

All edits go through the mutation runner, with an impact preview, the change log and undo, like
facts:

- **Sources:** create, edit, delete.
  - Deleting a cited source is refused with the count of citations, unless the request says to
    remove them too.
  - Merging two sources moves their citations, as an undoable change with a preview. This is the
    duplicate-source equivalent of union merge; dirty imports need it.
- **Repositories:** create, edit, delete. Link a repository to a source and unlink it, with a call
  number.
- **Citations:** add to a subject, edit, remove, reorder.
- **Optimistic concurrency** via `version`. A stale write answers 409 with
  `details.reason = 'STALE_VERSION'`, through the existing `treeHandler`.
- **Person merge (ADR-022) and union merge** carry every citation of the merged records, show the
  count in their preview, and never drop one. This is an exit criterion; test it.
- **Roles:** reuse `isActionAllowed` with new actions where needed.
  - Editing evidence needs `editor` or above.
  - `contributor` follows whatever it can do for facts today.
  - Write the rule into the ADR.

## Privacy

A source title can name a living person ("Birth certificate of …"), so evidence follows the people
it supports:

- A citation is visible only if its subject is.
- A source or repository is listed to a viewer only if:
  - the viewer's role sees everyone, or
  - the record supports at least one subject the viewer may see.

  Otherwise it isn't listed and its page answers 404, like a private person.
- Every new endpoint and load goes into `privacy-matrix.test.ts` with an honest `kind` and a test
  file that proves it. Add the reads to `privacy-reads.test.ts` / `privacy-records.test.ts` and the
  writes to `privacy-writes.test.ts`.
- **Export** stays role-gated as now and carries everything.

## UI

- **The person view:**
  - `PersonEvidence` becomes real: every citation for the person, grouped by what it supports
    (the person, each name, each fact), with source title, page, quality and date. Replace
    `PlaceholderDto` for `evidence`; leave `notes` as is.
  - In `PersonFacts` and `PersonNames`, each item shows:
    - a small sourced/unsourced marker with the citation count;
    - a way to open its citations and add one.
  - Both frames get this for free through `PersonView`. Check the drawer layout still reads well
    at `sm:w-96`.
- **Conflicting claims (exit criterion):**
  - Facts already carry `conflict`, and where two facts of one kind disagree they must both stay
    visible, each with its own citations.
  - Label the state clearly: sourced, unsourced or conflicting. Use text, not colour alone.
- **The union page:** the same, for the partnership, its events and the parent-child links shown
  there.
- **A citation dialog**, in the style of `FactDialog`:
  - pick a source with a search, or create one inline;
  - page, quality as worded choices (not 0 to 3), entry date with the existing `DateInput`, and
    text.
- **New routes:**
  - Sources list at `/trees/[id]/sources`: paged on the server like the people list, searchable
    by title and author.
  - Source page at `/trees/[id]/sources/[sourceId]`: details, repositories, and every citation
    that cites it, grouped by subject, each linking to the person or union.
  - Repository pages may be a section of the source page plus a small list. Keep them light.
- **Navigation:** add Sources to `TreeNav`.
- **Accessibility:** add the new pages to `accessibility.spec.ts`.

## Quality

Finish Phase 5 item 6's "unsourced key facts":

- A research suggestion (not a warning) for a birth, death or partnership event with no citation.
  Use the existing classification, reason text and dismissal.
- Over visible rows only, like the other checks.
- Deterministic, with tests.
- Make the "key facts" list a named constant.

## Rules

- **Layering and handlers:**
  - New endpoints use `treeHandler` (`src/lib/server/http/handler.ts`) and the shared error shapes.
  - No API shape change to existing endpoints except the added `evidence` field and the per-fact
    and per-name citation counts.
- **Performance:**
  - Evidence must not turn the person page into N+1 queries: load citations for a person's
    subjects in one or two queries, chunked with `param-chunks.ts`.
  - Add the index each new query needs.
  - Record any plan you measure in `docs/query-plans.md`.
- **Gate before every push:** `npm run check`, `npm run lint` and `npm test`.
  - If only `union-merge.test.ts` or `union-page-service.test.ts` hit the 5-second timeout, rerun
    them alone and note it.
  - Don't raise timeouts or skip tests.
- **e2e** is outside the gate. Add a spec for:
  - creating a source and citing it on a fact from the drawer and from the page;
  - the source page listing it;
  - a viewer not seeing a private person's citation or the source that only they support.

  Run it with the specs for facts, names, person merge, privacy and accessibility.
  - If no Chrome is installed, point Playwright at the installed Chromium through
    `executablePath` *locally, without committing it*.
  - If e2e can't run, say so.
- **Deploying migrations is not your job.** Write them and say in the summary which ones must be
  applied remotely, and that the backfill must run after them.

## Suggested order

One step per commit or a few, each passing the gate. Push at least after steps 3, 6 and 9.

1. `feat(evidence): source, repository and citation tables` (migration, schema, domain types)
2. `feat(gedcom): import sources, repositories and citations into records`
3. `feat(gedcom): export them from records` (the round-trip tests green, including merge and replace re-import)
4. `feat(evidence): backfill retained evidence into records` (script, test and README)
5. `feat(evidence): source, repository and citation commands` (mutation runner, undo, impact)
6. `feat(evidence): merges carry citations` (person and union merge, with preview counts)
7. `feat(evidence): privacy for sources and citations` (reads, the matrix and tests)
8. `feat(person): evidence in the person view and on the union page`
9. `feat(sources): sources list and source page`
10. `feat(quality): unsourced key facts`
11. `test(e2e): cite a source; privacy of evidence`
12. `docs: ADR for sources and citations; S15b status`. Add the ADR, a row and status section for
    S15b in `docs/improvement-plan.md`, update the capability map, and move this prompt to
    `docs/archive/`.

If you run short of context, stop at a step boundary with everything pushed. Write the status into
the improvement plan's S15b section so the next session can resume.

## Out of scope

- Shared and inline notes as records, research tasks, and media records (`OBJE` stays retained).
  These are S15c and Phase 7.
- Changing how facts, names or relationships are edited, beyond adding their citations.
- A filtered export for lesser roles.

## Done when

- A fact, a name, a person, a union and a parent-child link can each carry several citations, in
  order, from the UI and from GEDCOM.
- Sourced, unsourced and conflicting claims are distinguishable, with conflicting ones each
  showing their own evidence.
- Every GEDCOM round-trip test passes, `evidence-roundtrip.test.ts` unchanged.
- Merges never drop a citation.
- Evidence follows privacy, and the matrix is complete.
- The gate is green and the e2e specs listed above have been run (or their absence noted).
- Everything is pushed to `feat/s15b-sources-citations`, with a short summary covering:
  - the final model;
  - migrations and backfill to run remotely;
  - anything skipped and why.

Do not open a pull request or merge to `main` unless asked.
