# Architecture review: dead code, DRY and succinctness (2026-10-02)

A review of the code as of `e8adc88` (S12 deployed). It looks for code to cull, repetition to fold
into one place, and routes, pages and components that are longer than they need to be. Every
finding below was checked against the source. Line counts exclude tests and layout fixtures.

## Summary

The layering in ADR-006 holds up well. Domain logic is pure and well tested, services own
authorization, and the neutral model is used consistently. Most of the cost sits at the edges:

- **Transport is about 70% boilerplate.** 47 `+server.ts` files (60 handlers, 1,735 lines) each
  repeat the same auth, param, binding, service and context ceremony.
- **GEDCOM import and export bypass the layers.** Routes pass the raw D1 binding into
  `gedcom/importer.ts`, which queries and writes tables directly. Authorization for import is
  done by loading the whole tree.
- **Some legacy code survives the neutral-model migration.** There is a dead repository, a dead
  domain module, dead client calls, and an "individuals" API that runs alongside "people".
- **Client code repeats itself in places.** Load functions, chart pages, the person page and the
  drawer, and per-page CSS all have copies.
- **The documented conventions are not enforced.** AGENTS.md describes Prettier, ESLint naming
  rules and `vitest-pool-workers`. None of them is installed, and indentation is mixed (70 files
  use two spaces, 285 use tabs).

Estimated reduction: about 1,500–2,000 lines, with no change in behaviour.

---

## 1. Dead code to cull

Each item was confirmed unreferenced by production code (and, unless noted, by tests).

| Item | Where | Notes |
|---|---|---|
| `NeutralGenealogyRepository` (whole file, 123 lines) | `src/lib/server/repositories/neutral-genealogy-repository.ts` | No importers at all. |
| `IndividualRecord`, `EventRecord`, `DateRepresentation` (whole file) | `src/lib/server/domain/genealogy.ts` | No importers. Pre-neutral shapes. |
| `fetchTrees` | `src/lib/services/tree-api.ts:89` | Duplicate of `fetchTreeList` (line 339). |
| `fetchTreeDetails` + `GET /api/trees/[id]` + `GenealogyService.getTree` read path | `tree-api.ts:94`, `routes/api/trees/[id]/+server.ts` | No client caller. `getTree` is still used, wrongly, as an auth check (see §2.2). The route's `DELETE` stays. |
| `fetchRelationshipGraph` + the no-`focus` branch of `GET /graph` + `RelationshipService.getGraph` | `tree-api.ts:268`, `routes/api/trees/[id]/graph/+server.ts` | The handler's own comment says no screen uses it, and that it "goes when its last consumer does". The remaining consumers are tests and e2e support (`e2e/support.ts`). Move those to the focus graph or the service, then delete. |
| `contourBounds` | `tree-layout/contour.ts:32` | Never called. |
| `samePartnerUnionIds` | `server/domain/tree-ops.ts:598` | Never called. |
| `FACT_TEXT_FIELDS` | `shared/fact-types.ts:93` | Never read. |
| `SecurityContext` | `server/domain/identity.ts:24` | Never used. |
| `RelationshipPlanWarning` | `types/genealogy.ts:99` | Never used. |
| `src/lib/server/db/schema.ts` (one-line re-export) | | Fold into `db/schema/index.ts` imports. |
| npm: `@sveltejs/adapter-auto`, `d3-hierarchy`, `@types/d3-hierarchy` | `package.json` | Not imported anywhere. |
| npm: `d3` (the whole bundle) | `TreeCanvas.svelte` | Only zoom, selection, transition and ease are used. Depend on `d3-zoom`, `d3-selection`, `d3-transition` and `d3-ease`. |

About 200 more exports are `export`ed but only used inside their own file (for example,
`tree-ops.ts`: `buildOps`, `mergeOps`, `personSnapshot`). Drop the `export` keyword so the public
surface of each module is its real surface. This is cheap, and an ESLint or knip pass will keep it
honest (§4).

### Stale documentation

- `docs/improvement-plan.md` links `neutral-graph-layout.ts`, which no longer exists. Mark the
  document historical, or trim it to its open items.
- `docs/s6-*-prompt.md`, `s7-*` and `s8-*` are one-off agent prompts for slices that have shipped.
  Delete them, or move them to `docs/archive/`, and fix the two phase documents that link them.
- `docs/Screenshot *.png`: move to `docs/archive/` or delete.
- AGENTS.md says tests run under `@cloudflare/vitest-pool-workers`, but they actually use
  wrangler's `getPlatformProxy` (`server/testing/d1.ts`). Correct the documentation.

---

## 2. Architecture issues

### 2.1 API handlers are mostly ceremony (high value)

Every handler repeats this block:

```ts
if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
const { id: treeId, factId } = params;
if (!treeId || !factId) return Response.json({ error: '… required' }, { status: 400 });
if (!platform?.env?.DB) return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
try {
  const body = parseBody(schema, await request.json().catch(() => ({})));
  const service = new XService(getDb(platform.env.DB));
  … { user: locals.user, correlationId: locals.correlationId } …
} catch (err) { return errorResponse(err, '…'); }
```

That is 47 copies of the auth check, 57 of the binding check, and four of the `?version=` parsing.
**Proposal:** add one wrapper in `src/lib/server/http/handler.ts`:

```ts
export const PUT = treeHandler(
  { failure: 'Failed to save the fact', body: factUpdateSchema },
  ({ db, ctx, treeId, params, body: { version, ...fact } }) =>
    new FactService(db).update(treeId, params.factId, fact, version, ctx)
);
```

The wrapper owns the 401/400/500 checks, `getDb`, the `AuthenticatedContext`, `parseBody` /
`parseQuery`, `expectedVersion(url)`, `errorResponse`, and `Response.json` (with an optional
`status: 201`). Handlers shrink to between one and five lines. The repo is then about 1,100 lines
smaller, and a fix to any one of those checks lands in a single place.

### 2.2 GEDCOM import and export break the layering (high value, includes a correctness fix)

- `routes/api/import` and `routes/api/export` call `gedcom/importer.ts` with
  `platform.env.DB`. `importer.ts` then runs Drizzle queries and writes directly. This breaks the
  rule that routes never touch the database, and it puts persistence in the `gedcom/` folder.
- **Import authorization is wrong.** Both import handlers call `service.getTree(treeId)` to
  "verify gedcom:import permission". That checks `record:edit` rather than `tree:import`, and it
  loads every row of the tree only to throw them away. The two actions happen to share a minimum
  role today, so nothing is exploitable yet, but the next role change would silently break it.
- `getTreeExportData` (a read) lives in `importer.ts`. The "put the export in R2" code is
  duplicated between `routes/api/export` POST and `GedcomExportWorkflow`, and the two produce
  different filenames (tree name versus tree ID).
- The workflow repeats the membership check by hand.
- The large-file queue branch in `routes/api/import` duplicates the arguments that
  `import-consumer.ts` passes.

**Proposal:** split by layer:

```
server/gedcom/parser.ts        (parse*, normalize*, detectGedcomVersion; pure)
server/gedcom/serializer.ts    (buildGedcom551/7String, ExportName…; pure)
server/repositories/gedcom-repository.ts   (loadExportData, replace/merge writes)
server/services/gedcom-service.ts          (preview, import, exportText, exportToR2; authorizes
                                            with requireTreeAction('tree:import'|'tree:export'))
```

The routes, the queue consumer and the workflow all then call `GedcomService`. This also splits
the 929-line `gedcom/index.ts` along its natural parse/serialize seam.

### 2.3 One membership check, not five

`users.getMembership` plus `isActionAllowed` is written out in `tree-access.ts`,
`genealogy-service.ts` (`verifyTreeAccess`), `mutation-runner.ts` (`requireAccess`),
`member-service.ts` and `export-workflow.ts`. Use `requireTreeAction` and `requireTreeScope`
everywhere, and give the error message one wording.

### 2.4 Privacy masking repeated in services

`chart-service.ts:37-42` and `kinship-service.ts:58-61` are the same five lines: hide private
people, throw `NotFoundError` if the subject is hidden, then `maskRows`. `relationship-service.ts`
and `mutation-runner.ts` repeat the `scope.isRestricted ? maskRows(...) : …` ternary. **Proposal:**
add `maskForScope(rows, scope)` and `requireVisibleSubject(window, personId, scope)` beside
`maskRows` in `domain/privacy-mask.ts`. They take a `ViewerScope`, so no service unpacks
`cutoff`, `creatorId` or `shouldShowPrivateStructure` itself.

### 2.5 Finish the rename from "individual" to "person"

The routes `/api/trees/[id]/individuals[/…]` (create, update, delete),
`GenealogyService.*Individual` and `createIndividualApi` / `updateIndividualApi` /
`deleteIndividualApi` sit alongside `/people/[personId]/…` and the person page service.
**Proposal:** move them to `POST /people` and `PUT|DELETE /people/[personId]`, extract a
`PersonService` from `GenealogyService` (which then keeps tree CRUD only, and could be renamed
`TreeService`), and rename the client calls. The e2e helpers in `e2e/support.ts` that hit
`/individuals` move with them. `lists/individuals` can follow later, or stay as a list name.

### 2.6 Types have three homes

Shared types live in `src/lib/types/genealogy.ts`, `src/lib/shared/*` and
`src/lib/server/domain/*`. As a result:

- `ParentChildType` is declared twice (`types/genealogy.ts:69` and `domain/genealogy-model.ts:19`).
- `TreeRole` is declared twice (`shared/roles.ts:8` and `domain/identity.ts:1`). `ROLE_HIERARCHY`
  repeats the order in `TREE_ROLES`, with a test that exists only to keep the two in step.
- 17 client modules and 4 `shared/` modules import types from `#lib/server/...`. Examples are DTOs
  from `person-page-service.ts`, `UnionStatus`, and `RecordChange`.

**Proposal:** `shared/` becomes the only home for anything both sides read: the model enums, the
DTOs and the roles. Server domain modules import from `shared/`, and never the other way round.
Derive `ROLE_HIERARCHY` from `TREE_ROLES` (an index lookup) and delete the guard test. Dissolve
`types/genealogy.ts` into `shared/` once its remaining types have homes.

### 2.7 `hooks.server.ts`

- The access-token branch and the dev-bypass branch both run `getDb → new UserRepository →
  upsertFromAccess`, and both have a no-DB fallback. Fold them into one `resolveUser(identity)`.
- `catch (err: any)`: use `unknown`.
- Like 69 other files, hooks are two-space indented with long lines. The formatter pass (§4) will
  fix that.

### 2.8 Worth a decision, not urgent: universal loads over the app's own API

Every page `+page.ts` calls `tree-api.ts`, which calls its own `/api/…` endpoint through
`event.fetch`. On a server render, that runs `handle` again: the schema check, the JWT validation
and the user upsert. Moving the read-only loads to `+page.server.ts`, calling services directly,
would remove that second pass, about a dozen GET endpoints, and their `tree-api.ts` wrappers. The
trade-off is that client-side navigation then goes through SvelteKit's `__data.json` rather than
the JSON API, which also serves e2e and future clients. **Recommendation:** keep the current shape
for now. Write an ADR on it if server-render latency becomes noticeable.

---

## 3. Client: DRY and succinctness

### 3.1 Load functions

Eleven `+page.ts` files open with `depends(DATA_KEY); try { … } catch (cause) {
rethrowAsPageError(cause); }`. The generations parsing (`Number.isInteger(asked) && asked > 0 ?
…`) is copied into pedigree, descendants and hourglass (the hourglass also clamps). The three list
pages rebuild `offset` and `limit` into a new `URLSearchParams`.

**Proposal:** add these to `load-helpers.ts`:
- `treeLoad(fn)`, which wraps `depends` and the rethrow.
- `generationsParam(url, key, { fallback, max })`, which the API's `charts/*` handlers should share
  too. Today they `Number()` the raw value and let the service reject it.
- `listQuery(url, extra?)`.

### 3.2 Chart pages

`pedigree`, `fan`, `descendants` and `hourglass` each repeat the breadcrumb, the `<h2>`, the
style nav, the generation stepper and the "Show in the tree" link. Only the verb and the canvas
differ. **Proposal:** a `ChartPage.svelte` shell with `title`, `style`, `generations`, `max` and a
`children` snippet for the chart itself. Each page drops to about 15 lines.

### 3.3 Person page and drawer

`PersonDrawer.svelte` (436 lines) and `people/[personId]/+page.svelte` (508 lines) both render
parents, partnerships with children, direct children, siblings (full and half), step relatives,
facts and media, from the same `PersonPageDto`. **Proposal:**
- Extract `RelativesSections.svelte` (parents, partnerships, siblings and steps), with
  `hrefFor` and optional edit-action snippets. The page uses it read-only plus links, and the drawer
  passes its add and remove actions.
- Extract `FactList.svelte`, with an optional reorder, edit and remove action slot.
- In the drawer, move the media upload's raw `fetch('/api/media/upload')` into
  `tree-api.ts` (`uploadMediaApi`). Rename the "Attached Media (R2)" heading, which exposes an
  implementation detail.

### 3.4 Styles

- The person and union pages each declare identical scoped `.card`, `.heading`, `.btn` and `.link`
  rules (about 40 lines each). The utility string
  `font-semibold text-emerald-800 hover:underline` appears 23 times, and form labels repeat
  `mb-1 block text-xs font-semibold text-stone-700` 18 times.
- **Proposal:** define them once in `app.css` under `@layer components`: `.card`,
  `.section-heading`, `.btn`, `.link`, `.field-label` and `.input`. Then use the classes. Use
  Tailwind 4 `@utility` if the team prefers it to component classes.

### 3.5 Error toasts after mutations

The pattern `try { … await editor.afterChange(change, '…') } catch (cause) { toasts.push((cause as
Error).message || '…', { tone: 'error' }) }` appears 11 times across the person page, the union
page and the dialogs. **Proposal:** add `editor.mutate(run, { done, failure })` to
`tree-editor.svelte.ts` beside `confirmWithImpact`. That gives one place to treat conflicts, stale
versions and toasts consistently.

### 3.6 Big components

- **`TreeCanvas.svelte` (826 lines).** The d3 viewport (`moveTo`, `fit`, `zoomBy`,
  `ensureVisible`, the zoom behaviour; about 150 lines) can move to a `tree-viewport.svelte.ts`
  class. Keyboard navigation (`onKeydown`, `moveActive`) can move to a pure `tree-keyboard.ts`. The
  stub and collapser `<g role="button">` blocks share Enter/Space handling, as do three other
  places. Add a small `activateOnKey` action.
- **`RelationshipModal.svelte` (672 lines).** Review it after §3.5. It is the largest dialog, and
  probably holds per-intent sub-forms that could become snippets or child components.
- **`tree-editor.svelte.ts` (564 lines).** Leave it. It is the orchestration hub, and §3.5 adds to
  it, but deliberately.

---

## 4. Tooling to keep it this way

AGENTS.md documents conventions that nothing enforces:

1. Add `prettier`, `prettier-plugin-svelte` and `prettier-plugin-tailwindcss` with the documented
   config. Run them once in a single formatting-only commit, and add that commit to
   `.git-blame-ignore-revs`.
2. Add ESLint (flat config) with `typescript-eslint` type-aware rules, including the boolean
   `naming-convention` rule AGENTS.md already promises, and `eslint-plugin-svelte`.
3. Add `knip` (or `ts-prune`) as `npm run lint:dead`, so unused files, exports and dependencies
   fail a check rather than waiting for a review like this one.
4. Add `npm run lint` (prettier --check, eslint, knip) to the push gate.

---

## Action plan

Ordered so each step is a small, independently revertible commit (or a few), as AGENTS.md
requires. Steps 1–3 cut risk and noise before the structural work. Within a phase, the steps are
independent.

### Phase A: groundwork (no behaviour change)

| # | Commit | Verify |
|---|---|---|
| A1 | `chore(tooling): add prettier with the documented config` | `npx prettier --check .` runs |
| A2 | `style: format the repository with prettier`, plus `.git-blame-ignore-revs` | `npm run check`, `npm test` unchanged |
| A3 | `chore(tooling): add eslint with the boolean naming rule`; fix or allowlist the violations | `npm run lint` passes |
| A4 | `chore(tooling): add knip for unused files, exports and deps` | knip reports the §1 list |

### Phase B: cull dead code (§1)

| # | Commit | Verify |
|---|---|---|
| B1 | `refactor(server): delete NeutralGenealogyRepository and domain/genealogy.ts` | check, test |
| B2 | `refactor(client): delete fetchTrees, fetchTreeDetails and their GET endpoint` | check, test, e2e routes spec |
| B3 | `test: move whole-graph assertions to the focus graph`, then `refactor: delete the unfocused graph endpoint and getGraph` | test, e2e |
| B4 | `refactor: delete unused helpers` (`contourBounds`, `samePartnerUnionIds`, `FACT_TEXT_FIELDS`, `SecurityContext`, `RelationshipPlanWarning`, `db/schema.ts`) | check |
| B5 | `refactor: unexport module-private symbols` (driven by knip) | check |
| B6 | `build(deps): drop adapter-auto and d3-hierarchy; narrow d3 to its zoom modules` | build, bundle size, e2e tree zoom |
| B7 | `docs: archive shipped slice prompts and screenshots; fix stale links and test-harness note` | — |

### Phase C: server structure (§2.1–2.4)

| # | Commit | Verify |
|---|---|---|
| C1 | `feat(http): add treeHandler for auth, params, body and errors`, with unit tests for the 401/400/500 paths | new tests |
| C2–C5 | `refactor(api): use treeHandler in <group>/…`, one commit per resource group (trees, people/names/facts, unions/relationships, lists/search/charts/marks, members/privacy/places) | test and e2e per group |
| C6 | `refactor(auth): route every membership check through requireTreeAction` | test (authorization specs) |
| C7 | `refactor(privacy): add maskForScope and requireVisibleSubject; use them in the services` | test (privacy specs) |
| C8 | `fix(import): authorize with tree:import instead of loading the tree` | add a test that a viewer is refused, cheaply |
| C9 | `refactor(gedcom): split index.ts into parser and serializer` | GEDCOM round-trip tests |
| C10 | `refactor(gedcom): move export reads and import writes into GedcomRepository` | round-trip tests |
| C11 | `refactor(gedcom): add GedcomService; routes, consumer and workflow call it` (with one shared R2 export helper and one filename rule) | import/export tests, queue consumer test |
| C12 | `refactor(hooks): one resolveUser path for Access and dev bypass` | access tests |

### Phase D: model and types (§2.5–2.6)

| # | Commit | Verify |
|---|---|---|
| D1 | `refactor(types): make shared/ the home of ParentChildType, UnionStatus and TreeRole` | check |
| D2 | `refactor(types): move page DTOs to shared/; client stops importing from server/` | `grep -r "#lib/server" src/routes src/lib/components` shows only API routes |
| D3 | `refactor(auth): derive ROLE_HIERARCHY from TREE_ROLES; drop the guard test` | test |
| D4 | `refactor(api): move individuals endpoints to /people` (client and e2e support updated) | e2e |
| D5 | `refactor(server): split PersonService out of GenealogyService (now TreeService)` | test |

### Phase E: client succinctness (§3)

| # | Commit | Verify |
|---|---|---|
| E1 | `refactor(routes): treeLoad, generationsParam and listQuery helpers in load functions` | check, e2e charts and lists |
| E2 | `refactor(charts): ChartPage shell for the four chart pages` | e2e charts, accessibility spec |
| E3 | `style(ui): shared card, heading, btn, link and field classes in app.css` | visual check of the person, union and dialog pages |
| E4 | `refactor(editor): editor.mutate for change, toast and error` | e2e undo-and-conflict, facts, names |
| E5 | `refactor(person): RelativesSections and FactList shared by the drawer and the page` | e2e drawer-relatives, facts, names |
| E6 | `refactor(tree): extract the viewport and keyboard modules from TreeCanvas` | e2e keyboard and controls, layout tests |
| E7 | `refactor(media): uploadMediaApi; drop the R2 wording in the UI` | e2e |
| E8 | Review `RelationshipModal` after E4, and split per intent if it is still large | e2e relationship and partnership |

### Status

Kept up to date on branch `refactor/architecture-b-e`; a new session resumes from the first row that
is not done. Commits are named by subject because hashes change on rebase.

| # | State | Commit or reason |
|---|---|---|
| A1 to A4 | already done before this branch | Phase A landed before the branch |
| B1 | done | `refactor(server): delete NeutralGenealogyRepository and domain/genealogy.ts` |
| B2 | done | `refactor(client): delete fetchTrees, fetchTreeDetails and their GET endpoint`. `GenealogyService.getTree` stays: three service tests read a whole tree back through it |
| B3 | done | `test: move whole-graph assertions…` and `refactor: delete the unfocused graph endpoint and getGraph`. `GET /graph` now answers 400 without `focus` |
| B4 | done | `refactor: delete unused helpers`. `RelationshipPlanWarning` is still used by `RelationshipPlan`; it went in B5 as an unexport. Also removed the empty `src/lib/index.ts` and the bare `#lib` import alias |
| B5 | done | `refactor: unexport module-private symbols` |
| B6 | done | `build(deps): drop adapter-auto and d3-hierarchy; narrow d3…`. The bundle moved by 139 bytes, since it was already tree-shaken |
| B7 | done | `docs: archive shipped slice prompts and screenshots…`. `docs/architecture-b-e-prompt.md` was archived at the end of Phase E |
| knip rules block | done | `chore(tooling): make knip findings fail npm run lint` |
| C1 | done | `feat(http): add treeHandler and apiHandler…`, with tests for the 401 and 409 shapes, the 400, the 500, body and query parsing, `expectedVersion`, `status: 201` and `errorResponse` routing |
| C2 | done | `refactor(api): use treeHandler in trees/, summary, graph, undo, impact and quality` (the S13 quality endpoint is here) |
| C3 | done | `…individuals, people, names and facts/…`, with the S14 person-merge endpoints |
| C4 | done | `…unions/ and relationships/` |
| C5 | done | `…lists, marks, search and charts` and `…members, invitations, privacy and places`: two commits, since there were five groups |
| C2 to C5, not converted | skipped | `media/upload` and `media/[...key]`: they check the R2 binding as well as D1, answer through SvelteKit's `error()`, and one streams a body, so the wrapper would need options only they use. `import` and `export` went with C11 |
| C6 | done | `refactor(auth): route every membership check through requireTreeAction`, plus `requireMemberAction` for the workflow |
| C7 | done | `refactor(privacy): add maskForScope, omitForScope and requireVisibleSubject`. The focus window keeps its own optional-privacy shape |
| C8 | already done before this branch | the fix is `6b0568b`; this branch added `test(import): pin tree:import authorization…`, which refuses a viewer and fails if the check goes back to loading the tree |
| C9 | done | `refactor(gedcom): split index.ts into parser and serializer`, with a shared `tags.ts` |
| C10 | done | `refactor(gedcom): move export reads and import writes into GedcomRepository`. Parser and the pure preview and export-payload shaping stay in `gedcom/`; the neutral writer moved to `repositories/` |
| C11 | done | `refactor(gedcom): add GedcomService…`. Export names now use the sanitised tree name for both the download and the stored copy |
| C12 | done | `refactor(hooks): one resolveUser path for Access and dev bypass` |
| D1 | done | `refactor(types): make shared/ the home of ParentChildType, UnionStatus and TreeRole` |
| D2 | done | `refactor(types): move page DTOs to shared/; client stops importing from server/`; the grep output is in the commit body |
| D3 | done | `refactor(auth): derive the role order from TREE_ROLES; drop the guard test` |
| D4 | done | `refactor(api): move individuals endpoints to /people`. `GET /individuals/[id]` was dropped, not moved: nothing read it but one e2e check, which now reads the person page |
| D5 | done | `refactor(server): split PersonService out of GenealogyService (now TreeService)` |
| E1 | done | `refactor(routes): treeLoad, generationsParam and listQuery helpers in load functions`. The API's chart handlers keep their own parsing: they reject a depth out of range where a page clamps it |
| E2 | done | `refactor(charts): ChartPage shell for the four chart pages` (each page is about 40 lines, not 15, because the chart and its outline are page-specific) |
| E3 | done | `style(ui): shared card, heading, btn, link and field classes in app.css`. Named `section-card`, `action-btn`, `row-link` and so on, because four components scope classes called `.card`, `.btn`, `.link` and `.heading`. The Delete and Remove controls now render red as their markup asked: an unlayered scoped rule used to beat the layered utility |
| E4 | done | `refactor(editor): editor.mutate for change, toast and error`. Four person-page actions use it; the other error toasts return no change summary |
| E5 | done, differently | Skipped as written, then done as ADR-027: the two screens were made alike on purpose, and `PersonView` renders both. The drawer is a frame; the person page is a breadcrumb and a `PersonView`. `PersonDrawer.svelte` went from 564 lines to 117 and the page from 756 to 50; the section components hold the rest (about 1,165 lines across `src/lib/components/person/`, with the old copies gone). The one real copy, the media upload fetch, had already gone in E7 |
| E6 | done | `refactor(tree): extract the viewport and keyboard modules from TreeCanvas` (826 to 765 lines; the viewport class and the pure key reading are new modules with tests) |
| E7 | done | `refactor(media): uploadMediaApi; drop the R2 wording in the UI` |
| E8 | reviewed, not split | `RelationshipModal` is 864 lines, but its per-intent sections share the anchor, the debounced server preview, the validation and the conflict state with the parent, and each fragment is under 70 lines. Splitting would move state through bindable props without making anything easier to read. Revisit when a new intent is added |

### Expected outcome

- The API layer goes from about 1,735 lines to about 600, and every endpoint gets the same denial
  and error behaviour by construction.
- GEDCOM code respects the four layers, and authorization for import is correct and cheap.
- About 300 lines of dead server and client code are gone, plus three npm dependencies, and d3 is
  narrowed to the modules it uses.
- Client pages and components shrink by about 500–700 lines, with one copy each of the relatives
  view, the chart chrome, the mutation toast and the shared styles.
- Lint, format and dead-code checks stop the drift from coming back.

**Measured on `refactor/architecture-b-e` against `main` (non-test source lines):**

- The API layer (`src/routes/api/**/+server.ts`) went from 2,118 lines to 1,018, a drop of 1,100. The
  review's 1,735 figure was taken before S13 to S15a added endpoints. Media, import and export keep
  the most code; the 47 files that use `treeHandler` or `apiHandler` average 19 lines.
- Client pages and components (`src/routes/trees`, `login`, `welcome` and `src/lib/components`,
  excluding tests and `+page.server.ts`) went from 13,266 lines to 13,062, a drop of 204. The review
  expected 500 to 700; E5 (skipped) was most of the difference.
- All non-test source under `src/` went from 38,502 to 37,587 lines, a drop of 915, after adding the
  handler, the GEDCOM service and repository, the shared DTO modules, the viewport and keyboard
  modules, and the load helpers. Tests grew by about 80 cases, to 1,178.
- Dependencies: `@sveltejs/adapter-auto`, `d3-hierarchy` and `@types/d3-hierarchy` are gone, and
  `d3` and `@types/d3` give way to `d3-zoom`, `d3-selection`, `d3-transition`, `d3-ease` and their
  types. The client bundle moved by 139 bytes, since it was already tree-shaken.
