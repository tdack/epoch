# 3D tree views: layers and floors — staged plan

**Status:** proposed. **Design:** the
[3D Family Tree canvas](https://claude.ai/artifact/Pn1kMK4Aw6AM8ygmFee6Xv): board A is "Layered
household" and board B is "Generation floors". The canvas is private, so share it from its Share
menu before linking it anywhere else.

## What it is

Two more ways to draw the tree on `/trees/:id`, beside today's flat hourglass, chosen by one URL
parameter:

| `mode` | View | Depth means | Centred on |
|---|---|---|---|
| *(absent)* / `flat` | Today's hourglass | — | the focus person |
| `layers` | Upright planes, one behind another | collateral distance, one plane per step | the focus union |
| `floors` | Horizontal planes, one per generation | collateral distance, one band per step on each floor | the focus person |

- **Flat stays the default.** The last stage makes the default configurable, so either 3D mode
  could become the default later without removing flat.
- **Both 3D modes share one model.** Every drawn person gets a **band**: how far they sit off the
  direct line (the table below). `layers` turns a band into a plane; `floors` turns it into a row on
  a generation floor. Left–right always means "whose side": each partner's relatives stay on that
  partner's side.

## Placement rules shared by every view

These rules live in one pure module in `src/lib/tree-layout/`. Flat, layers and floors all call it,
so the same person lands in the same place relative to their family whatever the mode.

### Bands

| Band | Who | Name |
|---|---|---|
| 0 | The **direct line**: the focus person, their ancestors and descendants, and every partner of a band-0 person | direct line |
| 1 | **Siblings of the line**: any other child of a band-0 union, so the focus person's siblings and aunts and uncles at any height, plus their partners | sibling line |
| 2 | **Descendants of the sibling line**, plus their partners: nieces, nephews, cousins and their children | cousin line |

- Band 2 is the furthest band. Anyone who would be further back is counted in a "+N" stub on the
  nearest drawn person.
- A partner takes the band of the person they partner. A person qualifying for two bands takes the
  lower one.
- The band is a property of the selection, not of the view. It is computed once and every mode
  reads it, flat included (for step-children, below).
- In `layers`, the focus union partners' parents sit on plane 1 with their siblings. That is
  where the board puts them: they are the hub of the sibling group, and plane 0 is "the union and
  its descendants". This is the one place `layers` differs from the pure band count, and the
  module exports it as a per-mode override rather than a fork.

### Step-children: one rule, every view

A step-child is a child of one partner from another union (or a direct `parent_child` assertion
with no union). The child is **anchored to a biological parent who is drawn as a card**, and it
inherits that parent's group:

| View | "Group" the child inherits |
|---|---|
| `flat` | That parent's side of the chart, hanging from that parent's other union (or their direct-child line), never from the focus union's children bar |
| `layers` | That parent's plane, at that parent's edge |
| `floors` | That parent's band on the child's own generation floor |

- **Either biological parent qualifies** when they are drawn. When both are drawn, the tie-break
  is view-independent, so it gives the same answer in every view. Prefer, in order:
  1. The lower band.
  2. The earlier partner in the child's parent union (`union_partner` order).
  3. The lower person id.
- **No biological parent drawn:** fall back to any drawn parent (adoptive, foster, guardian,
  unknown), using the same tie-break.
- **No parent drawn as a card** (for example, a sibling's partner shown only as a sub-line in
  `layers`): the child is not drawn and is counted in that person's "+N" stub. This is how flat
  already treats partners' other families.
- The link keeps its `parent_child` line style. Step relationships stay derived from the union
  and are never drawn as their own line.

### Other shared rules

- **Pedigree collapse:** each person is drawn once, at their lowest band. Their other appearances
  are dashed placeholders. In 3D they are joined to the real card by a depth line, which is the
  3D form of today's "2 paths" badge.
- **Private people** (ADR-015) stay placeholders in every view, and no depth lines are drawn to
  them.
- **Large sibling sets** fold to a "+N" stack in any band other than 0. Band 0 never folds.

## Rendering decision (to record as the next free ADR, ADR-030 at the time of writing)

Use **CSS 3D transforms over HTML planes**, not WebGL (Three.js/Threlte), with one shared
`PlaneStack` primitive:

- A stage with `perspective` and `transform-style: preserve-3d`, holding planes placed with
  `translateZ`, plus "depth connectors": thin elements rotated into the Z axis.
- `layers` keeps the planes upright and rotates the stage a little about Y and X (the Front,
  Angled and Exploded presets). Its connectors join one person across planes.
- `floors` tips the whole stage about X (around 50°). Its connectors are parent–child drops between
  floors.
- Each plane holds its own `<svg>` with the existing `PersonCard`, `UnionMarker` and `TreeEdge`.
  The cards stay real DOM, so the browser hit-tests through the transforms. Roving tabindex,
  `aria-label`s, the context menu and the drawer behave as today, and nothing new is installed.
- Pan and zoom stay 2D on an outer wrapper before perspective, so `tree-viewport.svelte.ts` keeps
  its maths. Mapping a pointer into a plane (needed for drag-to-relate) needs an inverse
  projection, which is deferred.
- Given up: free orbiting. Each mode offers fixed camera presets only.

---

## Stage 0: spike and ADR (2–3 days)

- Throwaway branch: draw the current `TreeLayout` for `The_Simpsons_clean.ged` in a rough
  `PlaneStack`, both as upright planes (everything on plane 0 except siblings) and as floors
  (`y → floor`).
- Check in Chromium, WebKit and Firefox:
  - SVG text sharpness under `preserve-3d`, and blur when zoomed.
  - Clicks and focus landing on the right card through the transforms.
  - Frame time while panning with every card visible.
- **Exit:** the ADR (renderer, `mode` parameter, band model, step-child rule, what is deferred)
  accepted in `docs/decisions.md`; the spike is discarded.

## Stage 1: shared placement rules, applied to flat

This is the only stage that changes the default view, and only for step-children.

- **New module** `src/lib/tree-layout/kin-placement.ts`, pure, with:
  - `assignBands(selection, index)`.
  - `stepChildAnchor(childId, selection, index, bands)`, which returns the anchoring parent's id
    or `null`.
  - The tie-break and fallbacks above.
- **`select.ts`:** mark step-children explicitly, either with a role (`STEP_CHILD`, added to
  `PERSON_ROLES`) or as an `anchorParentId` on `SelectedPerson`. Today the selection only knows
  them as `DESCENDANT`s reached through a "step seed".
- **`place.ts`:** the flat hourglass hangs step-children from their anchor's union or
  direct-child line, on the anchor's side. Most already do; the tests find out which don't
  (adoptive-only parents, both biological parents drawn, a partner whose other union has no drawn
  partner).
- **Tests:**
  - `kin-placement.test.ts`: case-by-case table of the rule, tie-break and fallbacks.
  - New cases in `contract.test.ts`: the flat placement honours the anchor.
  - The fixture's crossing counts (`crossings.record.test.ts`) are re-recorded only if they get
    better, and any change to them is explained in the commit.
- **Exit:** the rule is enforced in flat with tests; nothing else visible changes.

## Stage 2: floors layout (no UI)

- `layoutFloors(graph, focusPersonId, options, metrics): FloorsLayout` in
  `src/lib/tree-layout/floors.ts`. It uses `selectFocusSubgraph` and `assignBands` unchanged.
- **Output:**
  - `floors[]`: one per generation.
  - `people[]` with `x`, `band` and `generation`.
  - `unions[]`.
  - `floorEdges[]`: segments drawn on a floor.
  - `drops[]`: where a line leaves a floor, and the floor below it lands on.
- **x placement:** start from `placeHourglass`'s x, so switching from flat doesn't reshuffle
  anyone. Then compact each (floor, band) row with the contour helpers.
- **Contract tests**, over the existing fixtures:
  - No overlaps within a row.
  - Everyone is placed exactly once.
  - Every drop lands on its union.
  - Output is deterministic.
  - Step-children sit in their anchor's band.

## Stage 3: `PlaneStack` and `mode=floors` (read-only preview)

- **URL:**
  - `TreeViewState.layoutMode`, taken from a `LAYOUT_MODES` `as const` object
    (`flat | layers | floors`). It defaults to `flat`, which is omitted from the URL.
  - `mode` is not added to `FETCHED_PARAMS` in `+page.ts`, so switching between flat and floors
    refetches nothing.
- **Toolbar:** a segmented "Flat | Layers | Floors" control (`aria-pressed`), using the `ADJUST`
  history kind. "Layers" shows disabled until stage 5.
- **Components:**
  - `PlaneStack.svelte`: the shared renderer, with camera presets as data.
  - `FloorsCanvas.svelte`: takes `TreeCanvas`'s props and is chosen by `+page.svelte` from
    `view.layoutMode`.
  - Reuses `PersonCard`, `UnionMarker`, `TreeEdge`, `TreeLegend` and the viewport.
- **Interactions:**
  - Click to refocus; double-click or long-press to open the drawer (ADR-027's `person`
    parameter is unchanged).
  - Stub expansion, and level of detail per floor.
  - The context menu, drag-to-relate and keyboard navigation wait for stage 6. The mode is
    labelled "Preview" until then.
- **Tests:** a component test that the mode switch keeps focus, depth and drawer; and
  `e2e/floors.spec.ts` for switching, reload, Back, and opening the drawer from a floor.

## Stage 4: wider selection (server)

`layers` needs relatives the focus graph doesn't fetch today, and `floors` benefits from them too.

- **New `FocusViewOptions`, with URL parameters added to `FETCHED_PARAMS`:**
  - `collateralDepth` (0–2, default 0, parameter `side`): siblings' partners and descendants, and
    parents' siblings.
  - `shouldIncludePartnerOrigins` (default off, parameter `origins`): the focus person's
    partners' parents and siblings.

  Each new group gets "+N" stubs.
- **`layers` turns both on** when the URL doesn't say otherwise. Flat ignores them until someone
  decides the hourglass should draw cousins.
- **Server:**
  - `fetchFocusGraph` and its endpoint carry the options.
  - Update the plans in `docs/query-plans.md`.
  - Add the new parameters to the privacy matrix, so a restricted viewer sees no more than their
    role allows.
  - No migration.
- **Exit:** the fixtures select three bands with no lost people; the privacy matrix covers `side`
  and `origins`.

## Stage 5: layers layout and `mode=layers` (read-only preview)

- **Focus union:**
  - `layers` centres on a union.
  - New optional URL parameter `union`, defaulting to the focus person's first union in graph
    order.
  - A focus person with no union gets a one-person plane 0, and a plane 1 with one side only.
  - The toolbar offers a union picker when the focus person has more than one union.
- **`layoutLayers(graph, focusPersonId, unionId, options, metrics): LayersLayout`**, in
  `src/lib/tree-layout/layers.ts`:
  - It uses `assignBands` with the `layers` override from the shared rules.
  - Each plane is laid out with the same per-row placement as flat.
  - Partner A's relatives go left and partner B's right, in `union_partner` order (never by sex).
  - On plane 1 and further back, siblings' partners are a sub-line on the sibling's card, not a
    card of their own.
  - Placeholders and depth links are produced for every cross-plane appearance.
- **Rendering:**
  - `LayersCanvas.svelte` on `PlaneStack`, with the Front, Angled and Exploded presets and the
    per-plane show/hide switches from board A.
  - "Bring forward" is simply refocusing on that person. Their union becomes plane 0, and the
    layers animate as in the board's storyboard (stage 6).
- **Tests:**
  - Contract tests per plane: no overlaps; each side stays on its side; depth links join the
    same person; step-children are on their anchor's plane.
  - `e2e/layers.spec.ts` mirrors `floors.spec.ts`.

## Stage 6: interaction parity (both 3D modes)

- **Keyboard** (`tree-keyboard.ts`), the same intents in both modes:
  - Arrows move within a row, and Up/Down along parent–child links.
  - Alt+Up and Alt+Down step between bands, which are planes in `layers` and rows in `floors`.
  - The DOM order matches the tab order: band by band, front first.
- **Context menu** and every editing action reached from it.
- **Drag-to-relate:** either build the inverse projection (a ray–plane intersection from the
  camera preset), or keep it flat-only and say so in the legend. Decide from stage 3 and 5 usage.
- **Animated refocus:**
  - `layers`: planes trade places.
  - `floors`: cards move between floors and bands.
  - Both are skipped under `prefers-reduced-motion`, which also picks the flattest camera preset.
- **Accessibility:** each plane or floor is a labelled group, and a card's accessible name says
  its band ("sibling line", "cousin line"). axe passes in `e2e/accessibility.spec.ts` for all
  three modes.
- **Exit:** both "Preview" labels come off; the keyboard e2e suite runs in all three modes.

## Stage 7: scale and polish

- Cull planes and floors outside the viewport.
- Fold wide bands into "+N" stacks.
- Budget: 60 fps panning with 300 visible cards.
- Camera presets and back-band fading become tokens in `tree-tokens.ts`. The contrast test in
  `tree-view.test.ts` covers faded text.
- Phones: below a breakpoint, `layers` shows one plane at a time as tabs. `floors` falls back to
  flat with a note, unless the spike found a readable tilt.
- **Exit:** budgets met on the largest fixture; cross-browser e2e (WebKit included) is green.

## Stage 8: a configurable default

1. **Per-user "remember my view":** a nullable `tree_view_mode` column on the per-user rows from
   ADR-014. It goes in its own expand-only migration, deployed before any code reads it. Absent
   means flat.
2. **Per-tree default, set by the owner:** a nullable column on the tree, used when the user has
   no preference of their own.
3. **What the URL means:** a link without `mode` then opens in the viewer's default. The same
   focus, depth and drawer still land. Copy-link writes `mode` explicitly from this stage on.
4. **Promotion checklist** before the product default (`DEFAULT_VIEW_STATE.layoutMode`) changes
   to a 3D mode:
   - Stage 6 parity is met, drag-to-relate included or deliberately excluded.
   - Stage 7 budgets are met.
   - The whole e2e suite is parameterised over all three modes and green.
   - A trial on the owner's own tree.

   Flat stays one click away on the same toggle.

---

## Order and dependencies

```
0 spike/ADR ─► 1 shared rules (flat) ─► 2 floors layout ─► 3 PlaneStack + floors
                                    └─► 4 wider selection (server) ─► 5 layers
                                         3 + 5 ─► 6 parity ─► 7 polish ─► 8 default
```

- Stages 2–3 and 4 can run in parallel after stage 1.
- `floors` can ship as a preview before the server work.
- `layers` waits for stage 4, because its plane 1 is mostly relatives the focus graph doesn't
  fetch today.
- This is Phase 6 (charts and views) work. Stage 4 touches the privacy matrix, so it follows
  Phase 4. Stage 8 needs one expand-only migration.

## Out of scope

- Free 3D orbiting, WebGL and VR.
- Printing or exporting either 3D view.
- Drawing cousins in the flat hourglass (stage 4 makes it possible; deciding to do it is
  separate).

## Status

Updated by each implementing session at a stage boundary: what is done, what is pushed, and anything
the next session must know.

| Stage | State | Notes |
|---|---|---|
| 0 | Done | ADR-030 accepted on **Chromium evidence only**: Firefox and WebKit were not measured because the cached Playwright builds do not launch (owner agreed to proceed). Re-check both before stage 7's cross-browser exit, repeating the ADR's Spike checks. Spike was scratch and is not committed. Plan wording changes: zoom must be CSS `zoom`/plane sizing, not an outer `scale()`; planes must be `pointer-events: none` with only cards clickable. |
| 1 | Done | `kin-placement.ts` (`assignBands`, `stepChildAnchor`) is pure and runs at the end of `selectFocusSubgraph`, which stamps `band`, `anchorParentId` and `isStepChild` on every `SelectedPerson` (an `anchorParentId`, not a `STEP_CHILD` role, so no role switch in the UI changes). `assignBands` returns `{ bands, stepChildIds }`. Rules as built: the line is the focus plus drawn ancestors and descendants; a line person's other child is band 1 and its blood descendants band 2 (clamped); a partner copies the band of who they partner; a partner's child from another union copies the partner's band and is a step-child, unless the child is also the child of the person that partner partnered (then it is that person's descendant). A direct-link-only tie-break uses the lower id. The `layers` override (focus-union partners' parents on plane 1) is **not** built; it belongs to stage 5. In flat, `claimChildren` now lets only the group holding the child's anchor claim it, and falls back to first come when the anchor is an ancestor card, on another row, or its union is not drawn. Crossing baselines and every existing contract test are unchanged, so nothing was re-recorded; the only visible change is a child asserted in two drawn groups (new test in `contract.test.ts`). Gate: `check`, `eslint`, `format:check`, `npm test` (1292) green; `npm run lint` still exits 1 on four knip unused exports from S15b (`citationsOfUnion`, `requireSource`, `requireRepository`, `hiddenSubjectKeys`), none in this change. e2e `controls`, `keyboard`, `accessibility` pass (15) on Chrome; they need a local `.dev.vars` (copy of `.dev.vars.example`) and `npm run db:migrate:local` in a fresh worktree. |
| 2 | Done | `layoutFloors` in `floors.ts` (no UI). It runs `layoutFocusView` for the flat x and `selectFocusSubgraph` for bands, then compacts each (floor, band) row: a gap that held other bands' cards in the flat row shrinks by their width, never below flat's own neighbour spacing, so unaffected gaps keep children under parents. Output: `floors[]`, `people[]` (x, band, generation, anchor), `unions[]` (band is the lowest partner band; x is the mean of its partners' moved x), `stubs[]`, `floorEdges[]` (partner and stub segments within a row) and `drops[]` (child lines, leaving the union, or the parent card for a link with no union, and landing on the child). Deviations: compaction is a gap-shrink sweep, not the contour helpers (rows are 1-D, so contours add nothing); the helper types are module-private until stage 3 imports them (knip). Contract tests sweep every fixture, focus and four option sets: no overlaps per row, everyone once in the band selection gave them, drops leave their union and land on their child, a union between its partners, step-children in their anchor's band, determinism across runs. Output is not input-order independent, because flat x isn't. Note: the selection reaches only the focus's own siblings today, so band 1 above the focus and band 2 appear only after stage 4. Gate green under Node 24 (a shell defaulting to Node 20 fails knip and the D1 tests); `npm run lint` still has the four S15b knip findings. |
| 3 | Done | `mode=floors` works end to end in the browser. `layoutFloors` now also returns `stubLinks` (a stub's line to its owner, which crosses floors) and `collapsers`; stub links replaced the stage 2 stub `floorEdges`. `tree-url.ts` has `LAYOUT_MODES` and `layoutMode` (`mode` in the address, `flat` omitted, not a fetched parameter). `plane-stack.ts` holds the named tokens (`FLOOR_TILT_DEG` 50, `FLOOR_GAP_PX` 260, `BAND_ROW_PX`, `PERSPECTIVE_PX`, `BAND_OPACITY`), the camera preset, band-row and floor-Z maths, the connector transform and `framingLayout`, all unit-tested. `PlaneStack.svelte` is the shared renderer (CSS `zoom` for zoom, translate for pan, planes click-through, only cards auto). `FloorsCanvas.svelte` draws one `<svg>` per floor with the existing `PersonCard`, `UnionMarker` and `TreeEdge`; parent-child lines and stub links are 3D connector elements between floors. Band 0 is the front row of a floor and bands 1 and 2 recede and fade. The toolbar has the Flat, Layers, Floors control (`aria-pressed`; Layers disabled; the `ADJUST` kind; stubs kept when switching). Preview-labelled: click refocuses, double-click or long-press opens the drawer, stubs expand and collapse, Escape clears. No context menu, drag-to-relate or arrow-key navigation until stage 6 (Tab reaches the focus card, then stubs). Deviations: `FloorsCanvas` takes a `FloorsLayout` and a smaller callback set rather than `TreeCanvas`'s exact props, because its data differs; `TreeViewport` now takes any `Element`, not only an `<svg>`, so it can attach to the HTML surface; `mode=layers` draws flat until stage 5; the per-floor level of detail only drops far floors (2 or more generations from the focus) from full to compact; no separate component test, because `e2e/floors.spec.ts` covers switching keeping focus, depth and the drawer, reload and Back, and a unit test covers the URL. Gate green under Node 24 (the four S15b knip findings remain); controls, keyboard, accessibility and floors e2e pass on Chrome. |
| 4 | Done | `FocusViewOptions` has `collateralDepth` (0–2, URL `side`) and `shouldIncludePartnerOrigins` (URL `origins`), both default off and carried by `tree-url.ts`, the `+page.ts` fetch (`FETCHED_PARAMS`), `fetchFocusGraph`, `parseFocusQuery` and so `loadFocusWindow`, which needed no change: it already loads whatever the selection draws. `select.ts`: `side` 1 draws the siblings of every drawn ancestor (through a drawn parent union, so not the topmost row's) with their partners and a "+N" stub for their children, 2 draws those children and their partners and stubs their children; an opened stub shows one generation more, as in the hourglass. `origins` walks up from each partner of the focus person to one row above them (a stub for what lies beyond, opened one generation at a time) and adds the partner's siblings; the ancestor walk is now `walkAncestors(root, lastGeneration)` so it can be reused. `assignBands` gains one rule: a partner's drawn parents are band 1 and their other children band 2 (nothing changed for existing selections, since a partner's parents are never drawn without `origins`). Flat ignores both options (the page passes them only in 3D modes; switching to Flat resets them), so the hourglass is unchanged. Toolbar: in a 3D mode, a Side branches stepper and a Partner's family checkbox. Tests: `select.collateral.test.ts` (hand-built family and a fixture sweep: the wider selection never loses a person, always banded, partners drawn with their union), `focus-window.test.ts` (window equals whole tree for three new option sets; wide window reads under a fifth of the rows), `privacy-wide-focus.test.ts` (new matrix: owner/editor see all, contributor/viewer nothing private, placeholders on and off, stub counts, not-found parity), URL and validation unit tests, and an e2e in `floors.spec.ts`. Query plans: no new lookup or index; measured in `docs/query-plans.md`. No migration. Deviations: **floors cannot place the new groups yet** — `layoutFloors` takes its x from the hourglass, which has no place for aunts, cousins or partner origins, so they are appended to the end of their floor row (`misplacedPersonIds`; the floors contract test allows that only for band 1 and 2 people when the options are on). Placing them is stage 5's per-band row layout, which floors should reuse, so a session in stage 5 should look at that. Aunts and uncles are found through parent unions only, as the focus's siblings always were, not through direct parent links. Gate green under Node 24 (the four S15b knip findings remain); controls, keyboard, accessibility and floors e2e pass on Chrome. |
| 5 | Done | `mode=layers` works end to end in the browser. **Layout:** `layoutLayers(graph, focusPersonId, unionId, options)` in `layers.ts`, with `assignLayerPlanes` in `kin-placement.ts` as the one override (a band-0 ancestor, and a step-parent who only partners ancestors, stands on plane 1; every other plane is the band). A plane is a flat chart in the hourglass's own coordinates (y is the generation row), x starts from the hourglass and `compactRows` closes the holes the planes leave. Sides: the focus union's first partner (`union_partner` order, never sex) and everything above them is `first`, the second partner and their family `second`, the union's children and what grows from them `centre`; everyone else takes the side of the person they hang from, a partner that of whoever they partner; each (plane, generation) row is then ordered first, centre, second. People the hourglass has no slot for (aunts, cousins, a partner's family, and the stubs of those groups) are put in the nearest free spot of their row by `nearestFreeX`, near their parents, else over their children. A child whose parents' union stands on another plane gets a dashed placeholder under the union (`ghosts`) and a `depthLinks` entry to the real card, so every plane reads complete; a private person gets neither. Edges are built per plane with the existing `buildEdges`, so a line never leaves its plane. **URL:** `union` (`TreeViewState.unionId`, not fetched; a new focus clears it); the toolbar shows a "Centred on" partnership picker when the focus person has more than one union. Arriving at Layers (toolbar, or a direct `?mode=layers` link with neither parameter) sets `side=2&origins=1` once; Flat resets them as before. **UI:** `LayersCanvas.svelte` on `PlaneStack` (which gained a per-plane `offset`): Front, Angled and Exploded presets and a show/hide switch per plane, both local to the viewer. Planes are staggered across and up (`LAYER_STAGGER_PX`) so no two cards of different planes can overlap on screen. Shared pieces extracted from `FloorsCanvas`: `StubMark`, `CollapserMark`, `ZoomControls`; `+page.svelte` has one `expandStub` and `collapseStub`. Preview-labelled: click refocuses, double-click or long-press opens the drawer, stubs expand and collapse; no menu, drag-to-relate or arrow keys until stage 6 (a placeholder is clickable but not a tab stop). **Tests:** `layers.test.ts` (every fixture, focus and five option sets: no overlaps per row, everyone once in the row selection gave them, each side on its side, every depth link joins a placeholder to the same person's card, edges land on cards of their own plane, a union between its partners, step-children on their anchor's plane, determinism; plus partner order under all four sex pairings, a reversed `union_partner` order, the union choices and fallbacks, and a person with no union), `plane-stack.test.ts` (offsets, no screen overlap between planes, the Y-then-X projection, framing and hidden planes), `tree-url.test.ts`, `e2e/layers.spec.ts` (switching keeps focus and depth and asks for the wider groups, one group per plane, a placeholder, side order on screen, camera and plane switches leave the address alone, the partnership picker through reload, a new focus resets it, the drawer from a plane, Flat and Back). **Deviations:** (1) a sibling's partner is a card on its plane, not a sub-line on the sibling's card as the plan said; a sub-line would hide a person who is clickable, can be private and can have children of their own, and floors already draws them as cards. (2) Planes are not the board's exact stack: the plane-1 override puts ancestors on plane 1, so plane 0 holds the union and its descendants only, and a plane with ghosts shows its focus person's placeholder rather than the card. (3) Floors still appends the stage 4 groups to the end of their row; `row-placement.ts` (`nearestFreeX`) is ready for it, but moving floors onto it changes floors' output and tests, so it is left for a later stage. (4) The default for `layers` is applied by the toolbar and by a one-time effect in the page, not by the fetch, because `mode` is deliberately not a fetched parameter (a switch would refetch). Row positions are not tidy-tree optimal: a child can sit off-centre from its parents where a row was packed, and lines may cross. Gate green under Node 24 (the four S15b knip findings remain); controls, keyboard, accessibility, floors and layers e2e pass on Chrome. |
| 6 | Done | Both 3D modes now behave like the hourglass. **Keyboard:** `plane-keyboard.ts` (`planeNeighbour`, `childLinks`) is the pure counterpart of `neighbourOf`: Left/Right stay in the row of one band (preferring a partner or sibling), Up goes to a parent and Down to the leftmost child on whatever plane or floor they stand, and Alt+Up / Alt+Down (`tree-keyboard.ts` intent `band`) step to the next band back or front, landing on the nearest generation then nearest x. The tab order is the roving one (one card), so DOM order does not decide it; within a floor bands now render front first. **Menus:** `tree-actions.ts` holds `personMenuItems` and `unionMenuItems`, shared with the flat canvas (which now uses them), so a card's menu is identical in all three modes; the 3D canvases take one `actions` object. Partnership nodes are focusable and open the editor on Enter. **Shared interactions:** `plane-interactions.svelte.ts` (menu, keyboard cursor, drag) is used by both 3D canvases. **Drag-to-relate: built, no inverse projection needed** — the browser hit-tests the transformed cards, so `elementFromPoint` finds the card under the pointer; both 3D modes call `editor.dragRelate`. **Refocus animation:** `PlaneStack` fades the planes in when the fit key changes (skipped for the first draw and under `prefers-reduced-motion`, which also starts Layers on the Front camera). **Accessibility:** planes and floors were already labelled groups, floor bands now are too ("Direct line", "Sibling line", "Cousin line"), cards say their band; axe is clean in layers and floors. Both "Preview" badges are gone. **Tests:** `plane-keyboard.test.ts`, `tree-actions.test.ts`, `tree-keyboard.test.ts` (Alt intents), and `e2e/keyboard-3d.spec.ts` which runs arrows and Alt, the menu, add-relationship, partnership Tab/Enter, drag and axe in both modes. **Deviations:** (1) the refocus is a fade, not planes trading places or cards sliding: cards live in per-plane SVGs, so one that changes plane is a new element and cannot move between them, and edges cannot be tweened in step. (2) Under reduced motion Floors keeps its tilt, because a flatter tilt stacks the floors on top of each other. (3) Lines are not interactive in the 3D views, so there are no line menus or parent-link popover and Delete does nothing; those stay in Flat and the drawer. (4) "Keyboard e2e suite in all three modes" is a new 3D spec mirroring the flat one, not a parameterised copy of `keyboard.spec.ts`: the flat edge/popover tests have no 3D equivalent. Gate: `check` 0 errors; ESLint 0 errors; `npm run lint` shows only knip findings from S15b/S15c files from `main` (none in this change); `npm test` 1487 passed with `union-merge` failing under load and passing alone; controls, keyboard, accessibility, floors, layers and keyboard-3d e2e pass on Chrome (33). |
| 7 | Done | **Scale:** `plane-scale.ts` holds two pure helpers. `isBoxInView` (with `planeScreenBox` in `plane-stack.ts`) culls a plane or floor whose projected box is off the canvas by more than 240 px: its cards, lines and marks are not drawn, but the plane shell and label are, and the plane holding the focus, the keyboard cursor or the open drawer is never culled, so focus cannot land on nothing. `foldWideRows` folds a back row (plane or band 1 and 2, never the direct line) of more than 10 cards: the cards nearest the focus stay, each run of the others becomes one dashed "+N more" mark (`FoldMark.svelte`, a tab stop, Enter or click opens the whole row) and everything that hung from a folded card (partnership, lines, placeholders, stubs) goes with it. The focus, the keyboard cursor and the drawer person are never folded. Opened rows are local view state, never in the address, and reset on a new focus. **Tokens:** `CAMERA_TOKENS` and `BAND_FADE` moved to `tree-tokens.ts`. The new contrast test (`tree-view.test.ts`) blends card fill and text over the canvas at each band's opacity and found that the spike's band 2 value (0.78) and the stage 3 value (0.82) both fall below AA for muted text on the male fill (4.0:1); band 2 is now 0.88. **Phones:** below 640 px, Layers shows one plane at a time with Union, Families and Cousins tabs (straight-on camera, no camera or plane switches), and Floors draws the flat view above a note ("Floors needs a wider screen"); the address keeps `mode=floors`, so widening the window restores it. **Budgets (scratch benchmark, not committed: a 1,222-person generated dynasty, 1440x900 at device scale 2, `up=2 down=2 siblings=1 side=2 origins=1`, a 3 s sine pan by mouse drag):** folded, 50 cards are in the DOM (layers) and 52 (floors); with every fold opened, 322. Chrome pans at 60 fps with p95 16.7 ms and max 16.8 ms in both modes, folded or opened. WebKit pans at 58 to 60 fps with p95 18 to 19 ms. The one long frame the harness saw in WebKit layers (0.6 to 1.3 s) is the last sample, between the final pan step and the harness reading the data, not a stall during the pan; WebKit floors' max is 47 to 55 ms. Headless runs are vsync-capped, so this says no frames are lost on this machine, not how a low-end phone fares. **Cross-browser:** WebKit 26 runs `floors`, `layers`, `keyboard-3d` and `scale-3d` e2e green (21 tests), with the same hit-testing, focus, drag and CSS `zoom` behaviour as Chrome. **Firefox could not be checked: the downloaded Firefox builds (1495 and 1543) do not start in this environment** ("Could not find profile folder", with a profile in `$TMPDIR` and in the repo, and Playwright's own launch hangs on the older build), as at stage 0. `playwright.config.ts` now has `chrome`, `webkit` and `firefox` projects, the last two limited to the 3D specs, so a machine where Firefox starts only needs `npx playwright test --project=firefox`. Firefox has supported CSS `zoom` since 126, but that is unverified here. **Tests:** `plane-scale.test.ts`, `plane-stack.test.ts` (`planeScreenBox`), the contrast test, and `e2e/scale-3d.spec.ts` (fold and open in both modes, floors out of view draw no cards and Fit restores them, the phone layout). **Deviations:** (1) culling is per plane or floor, not per card, which is enough for the budget and keeps the DOM stable inside a plane. (2) The cull test ignores perspective, so it uses a 240 px margin. (3) Firefox is unverified, as above. (4) The phone breakpoint is a viewport-width media query in the page, and the toolbar still shows Floors as the chosen mode on a phone. Gate green under Node 24 (`check` 0 errors; ESLint 0 errors; `npm run lint` only knip findings from S15b/S15c files from `main`; `npm test` 1498 passed). |
| 8 | Not started | |
