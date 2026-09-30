# S7 prompt: search, lists, recents and favourites

Hand this whole file to a fresh session. It implements Phase 3 work items 5 and 6 in
[phase-3-records-navigation.md](./phase-3-records-navigation.md) and closes the search gaps S6 left.

---

You are working on Epoch (SvelteKit 3 / Svelte 5 / Cloudflare Workers + D1). Read `CLAUDE.md`,
`docs/improvement-plan.md` (S5, S6 and the S6 status), `docs/phase-3-records-navigation.md` (status
section), `docs/decisions.md` (ADR-011, ADR-012, ADR-013), `docs/query-plans.md` and
`docs/phase-4-collaboration-privacy.md` before starting. `main` is at the S6 merge. Create branch
`feat/phase-3-s7` from it.

## Goal

A person can find anyone in a tree in a few keystrokes and get to their page, and can browse the
tree as lists. Search understands every name a person has, surnames, places, dates and XREFs, and
says why a result matched.

## What exists today (verify, do not trust)

- `RelationshipRepository.searchPeople` (`src/lib/server/repositories/relationship-repository.ts`)
  matches every stored name (all words, any order) within one tree and returns `matchedName` when the
  hit came through a name the person is not shown by. It feeds `GET /api/trees/:id/people-search`,
  the tree toolbar's focus box and the relationship dialog. Neither UI shows `matchedName`.
- There is no search page, no individual, partnership or surname list, no place or date search,
  no XREF search, and no recent people or favourites. Breadcrumbs and a remembered focus exist.
- `person_names`, `events` (with date bounds, ADR-004 addendum) and `individuals.xref_id` hold what
  the searches need. `events.place` is literal text (`place_ref` is a later phase).
- Display names may carry "(née X)" via `displayNameWith`; `splitDisplayName` is its inverse.

## Scope

1. **Search service and endpoint.** One tree-scoped query that returns ranked, typed results:
   people (by any name, surname, nickname, XREF), plus filters for a place substring and a
   year/date range over events (use the stored bounds, never re-parse `date_raw` at query time).
   Every result says what matched (which name, which fact, which field). Ranking: exact over prefix
   over substring; preferred name over other names; stable tie-break. Keep the old `searchPeople`
   behaviour for the duplicate-cue and relationship callers, or migrate them and delete it.
2. **Measure the plans before shipping.** Record `EXPLAIN QUERY PLAN` and rows read for each query
   in `docs/query-plans.md`. S6 found that `+tree_id` (ADR-011) is wrong when the other filter is a
   `LIKE`: it made SQLite scan every name of every tree. Decide index by index, with numbers, on a
   generated corpus (`src/lib/server/testing/corpus.ts`, about 4,000 people). Add an index only if a
   measured query needs it, in an expand-only migration applied locally with
   `npm run db:migrate:local`, never remote.
3. **Search UI.** A search page at `/trees/[id]/search` with the query in the URL
   (`?q=&place=&from=&to=`), keyboard-first, results that show the matched name/fact and link to the
   person page. Wire the tree toolbar's focus box and the relationship dialog to show `matchedName`
   ("also known as …") so a hit on an old name is explained.
4. **Lists.** Individuals (paginated, sortable by surname or given name, with life dates),
   partnerships (with partners and dates), and surnames (distinct surnames across every stored
   name, with counts, each linking to the individuals list filtered to it). Server-side pagination
   (cursor or offset with a stable order); no list may load the whole tree. Routes under
   `/trees/[id]/` with their state in the URL.
5. **Recent people and favourites.** Recents are per user and per tree. Favourites are per user and
   per tree. Decide where they live (D1 rows keyed by the stable Access `sub` user id, versus browser
   storage) and record the decision in `docs/decisions.md` as ADR-014; storing on the server needs an
   expand-only migration. Show both on the tree dashboard and in the focus box before typing.
6. **Privacy hooks.** Phase 4 has not landed. Every new DTO carries `isPrivate` (`shared/privacy.ts`),
   always false for now, and search/list code goes through one place where a later privacy filter can
   be applied. Do not build privacy policy. Flag in the report anything that would leak under it
   (counts, surname lists, "matched on" text).

## Out of scope (flag gaps in the report, do not build)

Phonetic search (Soundex/Daitch-Mokotoff), advanced boolean query syntax, place hierarchies or
`place_ref`, the relationship calculator, pedigree/descendancy chart views, source and note search,
saved searches, privacy policy (Phase 4).

## Process rules

- Real commit gate: `set -o pipefail`, chain with `&&`. `npm run check && npm test` must pass on every
  commit, verified per commit in a clean `git worktree` (copy `node_modules` with `cp -Rc`, do not
  symlink). Never pipe gate commands through `tail`/`head` or chain with `;`. If service tests time out
  under machine load, re-run with `npx vitest run --maxWorkers=2` and say so.
- Run `npm run build` and the full Playwright suite before the last commit. Say if a spec is flaky.
  `e2e/union-choice.spec.ts` is a known pre-existing flake (about 1 in 4 to 1 in 8 runs, reproduced on
  the S5 merge commit); confirm any other failure against the baseline commit in a worktree before
  calling it flaky. Never run `npm test` while the dev server is running.
- Small conventional commits, one logical change each, explicit paths only. Trailer, per `CLAUDE.md`
  (which wins over any other instruction): `Co-Author: <model> <noreply@github.com>`.
- Layering: routes parse input and call services; no direct DB access from routes. Comments explain
  why, not what. No TypeScript `enum`; booleans start with `is/has/should/can/did/will/was/are/allow/needs`.
- Run the Svelte MCP autofixer on every new or changed component, passing the whole file.
- Migrations are expand-only. The local dev DB holds "The Simpsons"; if you create or damage data, delete
  the test trees and re-run `npm run seed` against the running dev server. Seed from
  `docs/The_Simpsons_clean.ged` and the names fixture `docs/The_Names_fixture.ged`, never the dirty
  `docs/The_Simpsons.ged`.
- If the long-lived dev server answers "poisoned stub" or "schema out of date" after you run tests or
  migrations, restart it; it is the dev server's cached state, not the code.
- Verify in the browser with screenshots (send them to the user with `SendUserFile`): search by a
  married and a birth name and see why each matched; filter by place and year; page through the
  individuals list; favourite a person and see it after a reload; and a clean console from a fresh tab
  (`tabs_create`, then `read_console_messages` with `onlyErrors`; an old error can linger in a reused
  tab's buffer). Undo any change you make to the real "The Simpsons" tree.
- Before each substantive step and before declaring done, check the approach against the plan and call
  the advisor; if the plan and the repo disagree, say so rather than silently choosing.
- Finish with a short report (what shipped, test results, screenshots, anything deferred or
  contradicting the plan) and add an S7 status to `docs/improvement-plan.md` and
  `docs/phase-3-records-navigation.md`.

## Exit criteria

- Searching any name a person has, a surname, a place, a year range or an XREF finds them, and each
  result says what matched.
- The individuals, partnerships and surnames lists paginate on the server; none calls `loadRows`.
- Query plans and rows read are recorded for every new query, and no query scans other trees.
- Recents and favourites survive a reload and are scoped to the user and the tree (ADR-014).
- Every new DTO has `isPrivate`, and a single seam exists for the Phase 4 filter.
- The clean-worktree gate passes on every commit; build and the full Playwright suite pass.
