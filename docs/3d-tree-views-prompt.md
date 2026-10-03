# Prompt: S16, the layers and floors 3D tree views

Hand this whole file to a fresh session. It can be handed over more than once: each session picks
up at the first unfinished stage in the plan's Status table.

---

You are working on Epoch (SvelteKit 3 / Svelte 5 / Cloudflare Workers + D1 with Drizzle), a
private family-tree app. Your job is slice **S16**: two optional 3D ways to draw the tree on
`/trees/[id]`, beside today's flat hourglass, selected by a `mode` URL parameter:

- `layers`: upright planes, one behind another.
- `floors`: one horizontal plane per generation.

You are also bringing in one step-child placement rule that every view obeys, flat included.

**The specification is `docs/3d-tree-views-plan.md`.** Read all of it before anything else; this
prompt only adds how to work. Where they disagree, the plan wins on *what* to build, and this
prompt wins on *how* to work. The plan links a design canvas on claude.ai, but you probably can't
open it. You don't need it: the plan describes everything the boards show.

## Where to start

1. Read the plan's **Status** table at the end of the plan.
2. Start at the first stage that isn't `Done`.
3. If a stage is `In progress`:
   - Read its notes and the last commits on the branch (`git log --oneline main..`).
   - Finish that stage before starting a new one.

Work on branch **`feat/3d-tree-views`**:
- Create it from the latest `main` if it doesn't exist; otherwise check it out and merge `main`
  into it first.
- The repo needs Node ≥ 24.

## Read first

- **`AGENTS.md`.** Follow it exactly:
  - layering: routes never touch the database;
  - boolean prefixes, also for D1 columns by hand;
  - no `enum` (use `as const` objects);
  - comments explain why;
  - `Props` interfaces with TSDoc;
  - colocated tests;
  - expand-and-contract migrations;
  - small Conventional Commits with its commit trailer.
- **`docs/decisions.md`:**
  - ADR-015 (privacy), ADR-017 and ADR-020 (charts), and ADR-027 (the drawer in the URL).
  - Skim the "Tree rendering" section of `docs/improvement-plan.md` for how the flat canvas came
    to be (slices S1a to S1f).
- **Layout engine, `src/lib/tree-layout/`:**
  - `types.ts`, `select.ts` (selection, roles, stubs, the "step seed" walk), `place.ts`
    (hourglass placement), `index.ts` (`layoutFocusView`), `edges.ts`, `contour.ts` and
    `graph-index.ts`;
  - the tests: `contract.ts`, `contract.test.ts`, `layout.test.ts`, `select.test.ts`,
    `expand.test.ts`, `crossings.record.test.ts`;
  - the fixtures in `fixtures/` (`simpsons.graph.json`, `simpsons-dirty.graph.json`,
    `representative-551.graph.json`, `representative-7.graph.json`, `crossings.baseline.json`).
- **Canvas, `src/lib/components/tree/`:**
  - `TreeCanvas.svelte`, `PersonCard.svelte`, `UnionMarker.svelte`, `TreeEdge.svelte` and
    `TreeLegend.svelte`;
  - `TreeToolbar.svelte`;
  - `tree-url.ts` (view state in the URL);
  - `tree-keyboard.ts`, `tree-viewport.svelte.ts`, `tree-view.ts` (level of detail, labels) and
    `tree-tokens.ts` (colours, with contrast tests in `tree-view.test.ts`).
- **The page:**
  - `src/routes/trees/[id]/+page.svelte`;
  - `+page.ts`, especially `FETCHED_PARAMS`: what refetches and what only redraws.
- **The focus-graph read** (needed for stage 4):
  - `src/lib/services/tree-api.ts` (`fetchFocusGraph`);
  - `src/routes/api/trees/[id]/graph/+server.ts`;
  - `src/lib/server/services/graph-query-service.ts`;
  - `docs/query-plans.md`;
  - `src/routes/privacy-matrix.test.ts` and the privacy test files it names.
- **e2e:**
  - `e2e/controls.spec.ts`, `e2e/keyboard.spec.ts`, `e2e/accessibility.spec.ts`;
  - `e2e/support.ts`.

Use the Svelte MCP tools (documentation and `svelte-autofixer`) for every Svelte file you write or
change, if they are available.

## How to work each stage

- **Do the stages in the plan's order.** Stages 2–3 and stage 4 may be done in either order after
  stage 1, but finish one before starting the other.
- **One stage is one or a few commits.** Each commit passes the gate. Push at the end of every
  stage.
- **At the end of each stage**, update the plan's Status row in the same push:
  - set it to `Done`, or `In progress` with notes;
  - write in its notes anything the next session needs: decisions made, deviations from the plan
    and why, and follow-ups.
- **The gate, before every push:** `npm run check`, `npm run lint` and `npm test`.
  - Don't raise timeouts, skip tests or add `eslint-disable` to get past it.
  - A pre-existing flaky timeout may be rerun alone; note it.
- **e2e** (`npm run test:e2e`) is outside the gate. Run the specs each stage names, plus
  `controls`, `keyboard` and `accessibility`.
  - If no Chrome is installed, point Playwright at the installed Chromium through `executablePath`
    *locally, without committing it*.
  - If e2e can't run at all, say so in the Status notes.
- **Flat is the default and must not regress.**
  - Every existing layout contract test, crossing baseline and e2e spec stays green.
  - The only intended change to flat is the step-child anchor in stage 1. Any crossing-count
    change it causes must be an improvement, re-recorded deliberately and explained in the commit
    body.

## Stage notes beyond the plan

### Stage 0: spike and ADR

- **Build the spike outside the committed tree.** Use a scratch route or page in a local-only
  commit you drop, or a file under a git-ignored folder. It must not reach the branch.
- **Measure, don't guess.** Use Playwright in Chromium, WebKit and Firefox, if installed, against
  the dev server on the Simpsons fixture:
  - Screenshot each mode's tilt and judge text sharpness.
  - Click three cards through the transform and check the right `data-person-id` was hit.
  - Tab across cards and check the focus ring lands on visible cards.
  - Record frame timings while panning, with `performance.now()` around
    `requestAnimationFrame`.
- **Write the ADR** at the next free number (check `docs/decisions.md`; the plan's "ADR-029" may be
  taken). Cover the renderer, the `mode` parameter, the band model, the step-child rule, and what
  is deferred.
- **If the spike contradicts the plan, stop.** For example: CSS 3D text is unreadable in a
  supported browser, or hit-testing through `preserve-3d` is unreliable. Write the findings into
  the Status notes and the ADR as "proposed", push, and end the session with a summary. Don't
  switch to WebGL on your own.

### Stage 1: shared placement rules

- **Implement the band and anchor rules for every child, not only step-children.** For an ordinary
  child both parents are in one union, so the anchor is trivially that union. Special-casing
  "step" is what lets views disagree.
- **Test table.** `kin-placement.test.ts` must cover, at least:
  - Band 0, 1 and 2 membership on the Simpsons fixture with several focus people.
  - A partner taking their partner's band.
  - A person reachable at two bands taking the lower.
  - A step-child of a household partner.
  - A step-child whose two biological parents are both drawn on different bands.
  - A step-child with only an adoptive parent drawn.
  - A step-child with no parent drawn as a card, which becomes a stub count.
  - Determinism: the same input gives the same output across runs and input orders.
- **Add fixtures** in `test-support.ts` style, not JSON, if the existing ones lack a case.

### Stage 3: `PlaneStack` and `mode=floors`

- **Keep `TreeCanvas.svelte` unchanged where possible.** The page chooses the canvas component by
  `view.layoutMode`, and all canvases take the same props.
- **Every value is a named token.** Camera presets, plane gaps and the back-band fade go in
  `tree-tokens.ts` or a sibling constants file, with units in their names (`FLOOR_TILT_DEG`,
  `PLANE_GAP_PX`).
- **Write `e2e/floors.spec.ts`.**

### Stage 4: wider selection

- **The read is privacy-relevant.** Every new parameter goes into `privacy-matrix.test.ts` with a
  test proving a restricted viewer sees no more than before. Record any query plan you measure in
  `docs/query-plans.md`.
- **No migration in this stage.** If you find one is needed, stop and explain.

### Stage 5: layers

- **Write `e2e/layers.spec.ts`.**
- **Partner order is `union_partner` order, never sex.** Add a test.

### Stage 8: configurable default

- **Migrations are expand-only,** each in its own migration file.
- **Deploying migrations is not your job.** Say in the summary which ones must be applied remotely,
  and in what order relative to the code.

## Housekeeping

- On the first push, add a row for **S16** to the delivery-slices table in
  `docs/improvement-plan.md`:
  - the outcome in one sentence;
  - "in progress on branch `feat/3d-tree-views`";
  - a link to the plan.

  Keep it current as stages finish.
- When stage 8 is done, move this prompt to `docs/archive/`.

## If you run short of context

Stop at a stage boundary, or at a commit boundary inside a stage, with everything pushed and the
Status row saying exactly where you stopped. Never leave the branch failing the gate.

## Out of scope

- WebGL, Three.js, Threlte and free orbiting.
- Printing or exporting the 3D views.
- Drawing cousins in the flat view.
- Changing how relationships are edited.

## Done when (per session)

- The stages you took on are `Done` in the Status table, or precisely `In progress`.
- The gate is green, and the named e2e specs have been run (or their absence noted).
- Everything is pushed to `feat/3d-tree-views`.
- Your final message summarises:
  - stages completed;
  - deviations from the plan and why;
  - migrations to apply remotely, if any;
  - what the next session starts with.

Do not open a pull request or merge to `main` unless asked.
