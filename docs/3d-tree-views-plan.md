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

## Rendering decision (to record as the next free ADR, ADR-029 at the time of writing)

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
| 0 | Done | ADR-029 accepted on **Chromium evidence only**: Firefox and WebKit were not measured because the cached Playwright builds do not launch (owner agreed to proceed). Re-check both before stage 7's cross-browser exit, repeating the ADR's Spike checks. Spike was scratch and is not committed. Plan wording changes: zoom must be CSS `zoom`/plane sizing, not an outer `scale()`; planes must be `pointer-events: none` with only cards clickable. |
| 1 | Done | `kin-placement.ts` (`assignBands`, `stepChildAnchor`) is pure and runs at the end of `selectFocusSubgraph`, which stamps `band`, `anchorParentId` and `isStepChild` on every `SelectedPerson` (an `anchorParentId`, not a `STEP_CHILD` role, so no role switch in the UI changes). `assignBands` returns `{ bands, stepChildIds }`. Rules as built: the line is the focus plus drawn ancestors and descendants; a line person's other child is band 1 and its blood descendants band 2 (clamped); a partner copies the band of who they partner; a partner's child from another union copies the partner's band and is a step-child, unless the child is also the child of the person that partner partnered (then it is that person's descendant). A direct-link-only tie-break uses the lower id. The `layers` override (focus-union partners' parents on plane 1) is **not** built; it belongs to stage 5. In flat, `claimChildren` now lets only the group holding the child's anchor claim it, and falls back to first come when the anchor is an ancestor card, on another row, or its union is not drawn. Crossing baselines and every existing contract test are unchanged, so nothing was re-recorded; the only visible change is a child asserted in two drawn groups (new test in `contract.test.ts`). Gate: `check`, `eslint`, `format:check`, `npm test` (1292) green; `npm run lint` still exits 1 on four knip unused exports from S15b (`citationsOfUnion`, `requireSource`, `requireRepository`, `hiddenSubjectKeys`), none in this change. e2e `controls`, `keyboard`, `accessibility` pass (15) on Chrome; they need a local `.dev.vars` (copy of `.dev.vars.example`) and `npm run db:migrate:local` in a fresh worktree. |
| 2 | Done | `layoutFloors` in `floors.ts` (no UI). It runs `layoutFocusView` for the flat x and `selectFocusSubgraph` for bands, then compacts each (floor, band) row: a gap that held other bands' cards in the flat row shrinks by their width, never below flat's own neighbour spacing, so unaffected gaps keep children under parents. Output: `floors[]`, `people[]` (x, band, generation, anchor), `unions[]` (band is the lowest partner band; x is the mean of its partners' moved x), `stubs[]`, `floorEdges[]` (partner and stub segments within a row) and `drops[]` (child lines, leaving the union, or the parent card for a link with no union, and landing on the child). Deviations: compaction is a gap-shrink sweep, not the contour helpers (rows are 1-D, so contours add nothing); the helper types are module-private until stage 3 imports them (knip). Contract tests sweep every fixture, focus and four option sets: no overlaps per row, everyone once in the band selection gave them, drops leave their union and land on their child, a union between its partners, step-children in their anchor's band, determinism across runs. Output is not input-order independent, because flat x isn't. Note: the selection reaches only the focus's own siblings today, so band 1 above the focus and band 2 appear only after stage 4. Gate green under Node 24 (a shell defaulting to Node 20 fails knip and the D1 tests); `npm run lint` still has the four S15b knip findings. |
| 3 | Done | `mode=floors` works end to end in the browser. `layoutFloors` now also returns `stubLinks` (a stub's line to its owner, which crosses floors) and `collapsers`; stub links replaced the stage 2 stub `floorEdges`. `tree-url.ts` has `LAYOUT_MODES` and `layoutMode` (`mode` in the address, `flat` omitted, not a fetched parameter). `plane-stack.ts` holds the named tokens (`FLOOR_TILT_DEG` 50, `FLOOR_GAP_PX` 260, `BAND_ROW_PX`, `PERSPECTIVE_PX`, `BAND_OPACITY`), the camera preset, band-row and floor-Z maths, the connector transform and `framingLayout`, all unit-tested. `PlaneStack.svelte` is the shared renderer (CSS `zoom` for zoom, translate for pan, planes click-through, only cards auto). `FloorsCanvas.svelte` draws one `<svg>` per floor with the existing `PersonCard`, `UnionMarker` and `TreeEdge`; parent-child lines and stub links are 3D connector elements between floors. Band 0 is the front row of a floor and bands 1 and 2 recede and fade. The toolbar has the Flat, Layers, Floors control (`aria-pressed`; Layers disabled; the `ADJUST` kind; stubs kept when switching). Preview-labelled: click refocuses, double-click or long-press opens the drawer, stubs expand and collapse, Escape clears. No context menu, drag-to-relate or arrow-key navigation until stage 6 (Tab reaches the focus card, then stubs). Deviations: `FloorsCanvas` takes a `FloorsLayout` and a smaller callback set rather than `TreeCanvas`'s exact props, because its data differs; `TreeViewport` now takes any `Element`, not only an `<svg>`, so it can attach to the HTML surface; `mode=layers` draws flat until stage 5; the per-floor level of detail only drops far floors (2 or more generations from the focus) from full to compact; no separate component test, because `e2e/floors.spec.ts` covers switching keeping focus, depth and the drawer, reload and Back, and a unit test covers the URL. Gate green under Node 24 (the four S15b knip findings remain); controls, keyboard, accessibility and floors e2e pass on Chrome. |
| 4 | Not started | |
| 5 | Not started | |
| 6 | Not started | |
| 7 | Not started | |
| 8 | Not started | |
