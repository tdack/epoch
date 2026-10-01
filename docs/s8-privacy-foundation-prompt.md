# S8 prompt: privacy foundation (living people, one policy, visibility in the queries)

Hand this whole file to a fresh session. It implements Phase 4 work items 3, 4, 5 (people, facts,
unions) and 6 in [phase-4-collaboration-privacy.md](./phase-4-collaboration-privacy.md), and moves
the S7 privacy seam into the SQL. Member administration (item 1), suggestions (8), audit and history
(7, 9) and the export/R2 review (10) are later slices.

---

You are working on Epoch (SvelteKit 3 / Svelte 5 / Cloudflare Workers + D1). Read `CLAUDE.md`,
`docs/improvement-plan.md` (S7 status), `docs/phase-4-collaboration-privacy.md`,
`docs/decisions.md`, `docs/query-plans.md`, `src/lib/server/services/privacy-seam.ts` and
`src/lib/shared/privacy.ts`. `main` is at the S7 merge. Create branch `feat/phase-4-s8` from it.

## Why this slice first

The improvement plan says Phase 4 must land before the tree is shared with anyone. Phase 3 is not
closed (relationship calculator and chart views wait), but neither blocks sharing. Privacy does.

## What exists today (verify, do not trust)

- `auth/authorization.ts`: `isActionAllowed(role, action)` with a role ladder; actions are
  `tree:view|export|import|manage_members|delete|update_settings` and `record:create|edit|delete`.
  There is no per-person or per-record privacy.
- `hooks.server.ts`: the dev identity bypass is already opt-in via `ACCESS_BYPASS_DEV`; confirm it
  fails closed in production and has a test.
- Every record DTO spreads `privacyOf()` (always false). Search, lists and marks pass through
  `filterForViewer`, which runs after the SQL page is chosen and so cannot fix `hasMore`, page fill or
  surname counts.
- Ownership: the local DB has one tree with exactly one owner. The deployed DB has not been checked.
- No living-state derivation, no per-person override, no per-tree privacy settings.

## Scope

1. **Living-state derivation (pure domain).** `isLikelyLiving(person facts, now, settings)`: explicit
   death (a DEAT/BURI/CREM event, even undated) means not living; otherwise a birth or baptism year
   older than the threshold (per-tree, default taken from webtrees' maximum-alive age; confirm the
   number and record it) means not living; anything else is living or indeterminate and therefore
   private. Use the stored date bounds. A person with no dated fact is indeterminate.
2. **Override.** An explicit per-person privacy value (`auto`, `public`, `private`), set by a manager
   or owner. Expand-only migration; local only.
3. **One policy evaluator.** `canViewDetails(role, person privacy state)` used by every service. Owners
   and managers see everything; editors see everything they can edit; contributors and viewers see
   private people as placeholders. Map the existing actions onto Phase 4 item 2's capabilities and keep
   deny-by-default.
4. **Visibility in the queries.** A visibility predicate beside `tree_id` in the search, list, person,
   union and graph reads, so counts, `hasMore`, page fill and ordering are computed over what the
   viewer may see. Re-measure every changed plan in `query-plans.md` on the two-tree harness; a
   predicate that makes a query scan other trees or read far more rows is a failed slice.
5. **Placeholders.** A private person appears in a graph or on a partnership as "Private" with no
   name, dates, places, sex or notes, when the tree setting allows the structure to show; otherwise
   they are omitted. The setting is per tree. Unions, parent links, events, names, notes and media
   linked to a private person inherit the privacy.
6. **Inference tests.** A matrix test over role x privacy state x transport (search, each list, person
   page, union page, graph, marks, relationship search, people-search, undo, export) asserting that
   nothing about a private person is reachable by a viewer, including search `matches` text, counts,
   surname lists, error messages and ordering.
7. **UI.** Private people render as a placeholder card, the person page of a private person answers
   as a not-found style response for viewers, managers see and can set the override and the per-tree
   settings.

## Out of scope (flag in the report)

Invitations and member administration, suggestions and approval, audit and history UI, R2 and export
privacy (exports must at minimum be blocked or filtered; say which), media privacy, notes and
citation privacy beyond inheriting from the person.

## Process rules

Same as the S7 prompt: the clean-worktree gate (`npm run check && npm test`, `cp -Rc` for
node_modules, no piping, no `;`) on every commit; `npm run build` and the full Playwright suite
before the last commit; small conventional commits with explicit paths; trailer exactly as in
`CLAUDE.md` (`Co-Author: <model> <noreply@github.com>`); layering; Svelte autofixer on the whole
file; expand-only migrations applied locally only, never remote and no deploy; browser verification
with `SendUserFile` screenshots and a clean console from a fresh tab; undo changes to the real
"The Simpsons"; call the advisor before substantive work and before declaring done; finish with a
report and an S8 status in `docs/improvement-plan.md` and `docs/phase-4-collaboration-privacy.md`.

## Exit criteria

- Living and indeterminate people are private by default; an override wins over derivation.
- A contributor or viewer cannot reach a private person's data through any read transport,
  including search, counts, surname lists and errors; the matrix test proves it.
- Counts, `hasMore` and ordering are correct under the visibility predicate; plans re-measured.
- One policy function is used by every service; no service compares roles itself.
- Gate passes on every commit; build and Playwright pass.
