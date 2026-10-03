# Prompt: S15c, notes and research tasks

Hand this whole file to a fresh session.

---

You are working on Epoch (SvelteKit 3 / Svelte 5 / Cloudflare Workers + D1 with Drizzle), a
private family-tree app. Your job is slice **S15c**, which finishes Phase 5:

1. **Notes as records.** Shared notes (`0 @N1@ NOTE`, 7.0 `SNOTE`) and inline notes become real
   records: shown with what they describe, editable, privacy-aware and still lossless through
   GEDCOM 5.5.1 and 7.0.
2. **Research tasks** (Phase 5 item 8): to-do items attached to records and to quality findings.
3. **The last quality check Phase 5 lists:** privacy leaks.

S15b did the same for sources, repositories and citations. Its ADR (ADR-028) is your pattern:
follow its shape wherever it fits, and say why wherever it doesn't.

## Read first

- **`AGENTS.md`.** Follow it exactly:
  - layering;
  - boolean prefixes, also on D1 columns by hand;
  - no `enum`;
  - comments explain why;
  - `Props` with TSDoc;
  - colocated tests;
  - expand-and-contract migrations;
  - small Conventional Commits with its trailer.
- **`docs/phase-5-evidence-quality.md`.** Note its migration rule: "Convert existing free-text
  notes without inventing source links."
- **`docs/improvement-plan.md`:** the capability map, the slice table, and the S15b status section.
- **`docs/decisions.md`:** ADR-028, all of it, and ADR-023. Also:
  - ADR-013: a `NOTE` under a `NAME` that matches `NAME_CHANGE_NOTE` in `gedcom/tags.ts` is
    Epoch's own from-date and partnership. It is **not** a user note, and must keep working exactly
    as it does.
  - ADR-015 (privacy), ADR-016 (members and roles), ADR-021 (quality and dismissals), ADR-022
    (person merge) and ADR-027 (the shared person view).
- **The S15b code**, which is the template:
  - the evidence schema and migration 0020;
  - `gedcom/evidence-backfill.ts` and `scripts/backfill-evidence.mjs`;
  - the evidence commands, `citationCascadeOps`, and how merges move citations;
  - the evidence privacy SQL and `maskRows` test;
  - the sources routes;
  - the `evidence` section of `PersonView`.
- **Notes as they are today:**
  - `events.notes` and the "legacy description" flag on `FactDto` (`src/lib/shared/person-page.ts`);
  - `notes: PlaceholderDto` on the person page DTO;
  - `PersonNotes.svelte`;
  - where `NOTE` lines are kept: `gedcom_preserved`, the `gedcom_extra` columns, and citations'
    and sources' extras;
  - `fixtures/evidence.ged`, which has a header note, a shared note, pointers to it from a source, a
    person and an event, and inline person and event notes;
  - `evidence-roundtrip.test.ts`.
- **Quality:** `domain/quality-checks.ts`, `services/quality-service.ts`, `quality_dismissals` and
  the quality page.

Create branch `feat/s15c-notes-tasks` from the latest `main`. The repo needs Node ≥ 24.

## Notes

### The model

Decide the final shape after reading the code, and record it in a new ADR. Constraints:

- **Shared notes:**
  - One record per root `NOTE`/`SNOTE`: XREF and aliases, text, and in 7.0 `MIME` and `LANG`.
  - `gedcom_layout` for the text's own `CONT`/`CONC` split, as ADR-028 does.
  - `gedcom_extra` for the rest.
  - `created_by`.
- **Inline notes:**
  - Owned by exactly one subject, in order, like citations.
  - A pointer to a shared note is the same kind of attachment, pointing at the record instead of
    holding text.
- **Subject kinds:**
  - person, name, event, union, parent-child, source and citation;
  - repository too, if it fits cheaply.

  A note under anything not covered stays retained, as now. The header's `NOTE` is the file's, not
  the tree's: it stays retained.
- **Order is part of losslessness.** Notes interleave with citations and other lines under one
  parent. Check how ADR-028 kept positions, and keep notes' positions the same way. The round-trip
  tests are the judge.
- **The name-change note** (ADR-013) is never turned into a user note.
  - It stays exactly where and what it is.
  - A test proves an import, an edit and an export of a name with both kinds of note keep both.
- **`events.notes`.** Today a fact's first plain note lives in that column, and the fact editor
  writes it. A note must not have two homes, so:
  - fact notes move to note records;
  - the editor reads and writes them there;
  - the column **stops being read** (expand-and-contract). Dropping it is a later migration, not
    this slice.
  - Keep the "legacy description" behaviour honest: what was a description stays labelled as one.

  If you find a reason this is unsafe, stop and explain.
- **Migrations are expand-only**, one per logical change. Nothing is dropped or renamed.

### Existing trees

Extend the backfill pattern: an idempotent script that moves notes out of retained lines, extras
and `events.notes` into records, through the import's own parser and row builders.

- It must not invent links: a free-text note becomes a note, never a citation or a source.
- A test requires an old-way import plus the backfill to equal a fresh import, in rows and in both
  exports.
- Document running it in the README, after the migrations.

### GEDCOM

- **Import and export** in both versions, in position and order:
  - shared notes as roots, once each;
  - a 5.5.1 `NOTE @N1@` pointer and a 7.0 `SNOTE @N1@` mapped to the same record.
- **Identity for merge-mode re-import** (ADR-008):
  - shared notes by XREF or alias;
  - inline notes by subject, text and position.

  A second file adds what's new and duplicates nothing.
- **`evidence-roundtrip.test.ts` and every other round-trip test pass unchanged.** Extend them;
  don't edit expectations.
- **Add tests for:**
  - a 7.0 file with `SNOTE`, `MIME` and `LANG`;
  - notes interleaved with citations;
  - a note with `CONT`/`CONC` kept exactly;
  - a note on a citation and on a source;
  - a second export identical to the first;
  - replace and merge re-imports changing nothing;
  - a note following its fact through edit, person merge, partnership merge and undo.

### Writes

Through the mutation runner, with preview, log, undo, `STALE_VERSION` 409s and the 300-record
limit, as ADR-028:

- add, edit, remove and reorder a subject's notes;
- turn an inline note into a shared one, and attach an existing shared note;
- create, edit, delete and merge shared notes:
  - deleting one that is used answers `NOTE_IN_USE` with the count, unless told to detach it;
  - merging moves every use, and the merged XREF becomes an alias.

**Deletes and merges:** deleting a subject takes its inline notes and detaches shared ones. Person
and partnership merges carry every note, and their previews say how many.

**Roles:** use the same rights as ADR-028 (`record:create`, `record:edit`, `record:delete`), checked
before planning.

### Privacy

A note can name a living person, so notes follow the people they describe:

- An inline note is visible only if its subject is.
- A shared note is listed and served only if:
  - it is attached to a visible subject, or
  - the viewer made it.

  Otherwise it's a 404.
- Reuse ADR-028's approach: one SQL predicate and an in-memory filter held to the same answers by
  a test. Mind D1's expression-depth and compound-select limits, which ADR-028 hit.
- Every new endpoint and load goes into `privacy-matrix.test.ts` with an honest `kind` and a test
  file that proves it.

### UI

- **`PersonNotes`** becomes real:
  - The person's own notes, edited in place or in a `NoteDialog` (your choice, consistent in both
    `PersonView` frames).
  - Replace `PlaceholderDto` for `notes`, and remove `PlaceholderDto` if nothing else uses it.
- **Notes on facts, names, citations and sources** show beside them, next to the citation marker S15b
  added. Keep the drawer layout readable at `sm:w-96`.
- **Shared notes** show where they're used, and say so. "Shared note, used by 4 records" links to
  the note's page.
- **New routes:**
  - `/trees/[id]/notes`: shared notes, paged on the server and searchable by text.
  - `/trees/[id]/notes/[noteId]`: the text and every record that uses it, each linking to its person,
    partnership or source.
  - Add Notes to `TreeNav`.
- **The partnership and source pages** get their notes too.

## Research tasks

Epoch's own data. There is no standard GEDCOM home for tasks, so they are **not exported**, and an
imported `_TODO` (webtrees) or similar custom tag stays retained verbatim as now. Say this in the
ADR.

- **Model:**
  - Per tree: title, details, a status from an `as const` object (`open`, `done`, `dropped`), an
    optional assignee (a member of the tree), and an optional due date.
  - `created_by`, timestamps, `version`.
  - An optional link to one record (person, union, source, shared note, event) and/or to one
    quality finding, by the same `finding_key` dismissals use.
  - Decide what happens to a task when its record is deleted or merged (move with a merge; on
    delete keep the task with its link cleared, and say so on the task). Test both.
- **Writes:** through the mutation runner with log and undo.
  - **Roles:** a contributor can create tasks and edit their own; editors and above edit any.
  - **Assignees:** only members of the tree. Removing a member leaves their tasks unassigned, not
    deleted.

  Write the rule into the ADR.
- **Privacy:** a task linked to a record the viewer can't see is hidden from them, title included.
  Unlinked tasks are visible to every member. Add tasks to the matrix.
- **UI:**
  - `/trees/[id]/tasks`: open by default, filters for mine, status and linked record; paged on the
    server.
  - A Tasks section in `PersonView` for tasks linked to that person or their facts, with "Add task".
  - In the quality report, each finding offers "Create task". A finding with an open task says so
    and links to it.
  - Completing the linked task does not dismiss the finding; they're separate decisions.
  - Add Tasks to `TreeNav`.

## Quality: privacy leaks

The last check Phase 5 item 6 lists:

- Define it narrowly, from data the tree already holds. For example: a person the living-state rule
  thinks is probably living but whose override makes them public; or a public record whose notes
  or citations are attached to a private person and name them.
- Pick checks that are deterministic and explainable. Record the exact rules in the ADR.
- **Results are shown to managers and owners only**, since the finding itself names the person.
- Classed as a warning, with the usual reason text and dismissal.
- Tests over the privacy fixtures.

If no rule in this area is precise enough to be useful, say so in the ADR and skip it rather than
ship a noisy one.

## Rules

- **Layering:**
  - New endpoints use `treeHandler` and the shared error shapes.
  - No change to existing API shapes, except the added note and task fields and the fact's notes
    now coming from records.
  - Update the client and tests for that last one.
- **Performance:** a person's notes and tasks load in one or two queries, chunked with
  `param-chunks.ts`. Add the indexes each query needs, and record measured plans in
  `docs/query-plans.md`. `TreeRows` already loads the evidence tables for every mutation. If adding
  notes makes that too heavy, measure it, and load them only for the commands that need them.
- **Gate before every push:** `npm run check`, `npm run lint` and `npm test`.
  - If only `union-merge.test.ts` or `union-page-service.test.ts` hit the 5-second timeout, rerun
    them alone and note it.
  - Don't raise timeouts or skip tests.
- **e2e** is outside the gate. Add specs for:
  - adding a note to a fact from the drawer and from the page;
  - sharing a note between two people and seeing both on its page;
  - creating a task from a quality finding and completing it;
  - a viewer not seeing a private person's notes or tasks, or a shared note used only by them.

  Run them with the specs for facts, names, sources, quality, privacy and accessibility, and add
  the new pages to `accessibility.spec.ts`.
  - If no Chrome is installed, point Playwright at the installed Chromium through
    `executablePath` *locally, without committing it*.
  - If e2e can't run, say so.
- **Deploying migrations is not your job.** List the migrations to apply remotely and the backfill
  to run after them.

## Suggested order

One step per commit, or a few. Push at least after steps 3, 6, 9 and 12.

1. `feat(notes): note tables` (migration, schema, domain types)
2. `feat(gedcom): import notes into records`
3. `feat(gedcom): export notes from records` (the round-trip tests green, including re-imports and
   the name-change note)
4. `feat(notes): backfill retained notes and fact notes into records`
5. `feat(notes): note commands; fact notes read and written as records`
6. `feat(notes): merges and deletes carry notes; privacy for notes`
7. `feat(person): notes in the person view, partnership and source pages`
8. `feat(notes): shared notes list and page`
9. `feat(tasks): research task table and commands`
10. `feat(tasks): privacy, tasks page and person view section`
11. `feat(quality): tasks from findings; privacy-leak checks`
12. `test(e2e): notes, shared notes, tasks and their privacy`
13. `docs: ADR for notes and research tasks; S15c status`
    - the ADR;
    - an S15c row and status section in `docs/improvement-plan.md`;
    - the capability map, with Phase 5 marked complete if it is;
    - move this prompt to `docs/archive/`.

If you run short of context, stop at a step boundary with everything pushed. Write the status into
the improvement plan's S15c section so the next session can resume.

## Out of scope

- Media records (`OBJE` stays retained; Phase 7).
- Exporting tasks.
- Dropping `events.notes` (a later contract migration).
- Notifications or email for task assignment.
- The 3D tree views (S16, `docs/3d-tree-views-prompt.md`). They may be built in parallel on
  another branch.
  - Take the next free ADR number when you write the ADR, not before. Check `main` again just before
    you commit it.
  - Expect to merge `main` into your branch for `docs/decisions.md` and
    `docs/improvement-plan.md`.

## Done when

- A person, name, fact, partnership, parent-child link, source and citation can each carry several
  notes in order, inline or shared, from the UI and from GEDCOM.
- Every round-trip test passes unchanged, and the name-change note still works.
- Merges and deletes never drop a note.
- Research tasks can be attached to records and findings, and follow privacy.
- The privacy-leak check is shipped, or deliberately skipped with a reason.
- The gate is green and the listed e2e specs have been run (or their absence noted).
- Everything is pushed to `feat/s15c-notes-tasks`, with a short summary covering:
  - the final model;
  - the `events.notes` change;
  - migrations and backfill to run remotely;
  - anything skipped and why.

Do not open a pull request or merge to `main` unless asked.
