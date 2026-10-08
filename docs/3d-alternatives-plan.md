# 3D alternatives: Ball, Ribbons and Orrery — staged plan

**Status:** planned 2026-10-08. Nothing built yet.

Three more WebGL views beside Rings (ADR-032), chosen from the same layout control. Each one is an
experiment the owner wants to compare with Rings. None of them edits; Flat and the drawer remain the
editing surfaces.

| `mode` | Label | Idea |
|---|---|---|
| `poincare` | Ball | Everyone inside a see-through unit ball. Height is calendar time; distance from the axis is compressed hyperbolically toward the glass, so wide generations never clip. |
| `ribbons` | Ribbons | Lineages are tubes. Two partners' tubes meet at a glowing knot for their union, and the children's tubes branch out downstream like a river delta. |
| `orrery` | Orrery | A force-directed "star cluster". Partners are a binary star; children orbit their parents' shared centre; a person with several unions holds several binaries together. |

## Rules for every mode

These come from ADR-032 and CLAUDE.md. Every session follows them.

- **Same people as every other view.** Each layout module calls `selectFocusSubgraph` on the focus
  graph, exactly as `layoutRings` does. There is no new endpoint, no new fetch rule and no new
  privacy surface.
- **Private people** are drawn as plain, unnamed, unpickable markers, as on Rings. Nothing derived
  from their data, such as an estimated era, is shown or used to position anyone else visibly.
- **Neutral model, not the prose.** The idea text speaks of husbands, wives, marriages, and
  maternal and paternal streams. In code:
  - "Marriage" is a **union**. Never infer or label one as a marriage.
  - "Husband and wife" are **union partners**, in `union_partner` order. Colour them with the
    existing sex tokens (`RING_TOKENS.male`, `.female`, `.unknownSex`); sex can be null.
  - "Maternal/paternal stream" is the **first and second partner's line** of a union. Do not
    assume one of each sex, or exactly two.
  - "Henry VIII" means **a person with several unions**. Each union is distinct, even between the
    same two people, and a death never ends or hides a union.
- **Pedigree collapse:** each person is drawn once, with converging lines, as on Rings.
- **Accessibility floor (as ADR-032):**
  - Names are real buttons over the canvas for the focus line, with an "All names" switch.
  - Enter refocuses, Shift+Enter opens the drawer, Escape clears the selection.
  - The canvas announces the focus and the counts.
  - Private people cannot be picked.
- **Performance:**
  - three.js stays in a dynamic `import()` from the canvas component.
  - Draw on demand, keeping the controls' `change` redraw (the zoom bug in ADR-032).
  - Merge geometries where there are hundreds of meshes, such as Ribbons' tubes.
  - Target: the owner's 314-person Simpson tree (8 generations each way, about 202 drawn people)
    lays out in under 100 ms and orbits smoothly.
- **Pure layout, tested.**
  - `src/lib/tree-layout/<mode>.ts` holds only maths: no three.js and no DOM.
  - It returns plain positions in scene units, with a colocated `<mode>.test.ts` against the
    fixtures in `src/lib/tree-layout/fixtures/`.
  - Anything random is seeded from person ids, so the same graph always gives the same picture.
- **No migration.** `view_mode` and `default_view_mode` are text, and the server validates against
  `LAYOUT_MODE_VALUES`, so new values need no schema change.

## Stage 0 — the common switcher and shared stage (one session, first)

Everything shared is done here and then frozen. The mode sessions never open a file this stage
owns.

1. **Modes.**
   - Add `POINCARE: 'poincare'`, `RIBBONS: 'ribbons'` and `ORRERY: 'orrery'` to `LAYOUT_MODES`
     in `src/lib/shared/view-mode.ts`, and to `OFFERED_LAYOUT_MODES`.
   - Update `view-mode.test.ts`.
2. **One per-mode config instead of scattered checks.**
   - Add a `VIEW_MODE_TRAITS` record keyed by `LayoutMode` with these fields:
     - `isWebGl`
     - `shouldAskWiderGroups`: today true for Layers and Rings.
     - `arrivalDepth`: `RINGS_ARRIVAL_DEPTH` for the WebGL views, else null.
     - `canEdit`: false for the WebGL views; drives the gesture-hint flags.
     - `isPhoneFallbackToFlat`: today true for Floors only.
   - Replace the hard-coded checks with it: `tree-url.ts` (`wideGroupDefaults`), the
     `layoutMode` change handler and the `!ringsLayout` gesture-hint flags in
     `src/routes/trees/[id]/+page.svelte`, and `display-settings.ts`.
   - Behaviour for Flat, Layers, Floors and Rings must not change.
3. **Switcher shape.**
   - Five offered modes no longer fit the segmented control at phone width.
   - Keep the segmented control for **Flat** and **3D**. Beside the 3D button, add a picker for
     the WebGL view: Rings, Ball, Ribbons or Orrery.
   - The picker remembers the last-used 3D view in `localStorage`, wrapped in try/catch, so the 3D
     button returns to it.
   - A withdrawn mode (Layers or Floors) still shows when it is in force, as `layoutModeChoices`
     does today.
   - Both default-view pickers list every offered mode by its label.
   - Fill in `MODE_LABELS` and `MODE_DESCRIPTIONS` for all three modes, in a relative's words.
   - Check at 375 px and on desktop.
4. **Page wiring.**
   - `+page.svelte` gets one `$derived` layout per new mode, built only when that mode is drawn,
     and one `{:else if}` branch per canvas.
   - Each canvas takes **exactly RingsCanvas's `Props`**: `layout`, `fitKey`, `selectedPersonId`,
     `onSelectPerson`, `onOpenPerson` and `onClearSelection`.
5. **Shared stage.**
   - Extract the mode-independent half of `rings-scene.ts` into
     `src/lib/components/tree/three-stage.ts`:
     - renderer and resize
     - perspective camera, `OrbitControls` with damping, and the `change` → dirty redraw
     - on-demand frame loop, the `onFrame` callback and `requestFrame`
     - `project(position)` to CSS pixels
     - raycast picking over a set of meshes tagged with a person id
     - the fat-line helper (`Line2`) and the hairline helper
     - framing of a bounding box with presets, and dispose
   - Rings then uses it. Do the same for the DOM half of `RingsCanvas.svelte`: name buttons,
     announcements, keyboard, camera presets, spin, "All names", reduced motion and the WebGL
     failure message. Extract it into a `WebGlTreeShell.svelte` that a mode canvas wraps around
     its scene.
   - Gate: `rings.test.ts`, `ring-labels.test.ts` and `e2e/rings.spec.ts` pass unchanged.
6. **Stubs.**
   - For each mode, create:
     - `src/lib/tree-layout/<mode>.ts`: calls `selectFocusSubgraph` and returns people with a
       trivial position.
     - `src/lib/components/tree/<mode>-scene.ts`: draws a sphere per person on the shared stage.
     - `src/lib/components/tree/<Mode>Canvas.svelte`: the shell around the scene.
     - `e2e/<mode>.spec.ts`: opens `?mode=<mode>` and sees the focus name button.
   - Every stub export must be used, or knip fails `npm run lint`.
   - The mode file names are `poincare`, `ribbons` and `orrery`; the components are
     `PoincareCanvas`, `RibbonsCanvas` and `OrreryCanvas`.
7. **Tokens.** Add an empty, exported, `as const` token block per mode to `tree-tokens.ts`
   (`POINCARE_TOKENS`, `RIBBON_TOKENS` and `ORRERY_TOKENS`), each referenced by its stub. Mode
   sessions then edit only their own block. The blocks are far enough apart that git merges them
   cleanly.
8. **Controls e2e.** Update every spec that lists the toolbar's modes, including `controls.spec.ts`
   and `default-view.spec.ts`.

**Exit:** `npm run lint`, `npm test` and the e2e specs for controls, default-view, rings and the
three stubs pass. Commit in small conventional commits on this branch.

## Stages 1–3 — one session per mode, in parallel

Each runs in its own worktree cut from the Stage 0 commit. **A mode session edits only these
files:**

- `src/lib/tree-layout/<mode>.ts`, its test, and any new helper module in `src/lib/tree-layout/`
  prefixed with the mode name, or `eras.ts` for Ball.
- `src/lib/components/tree/<mode>-scene.ts`, `<Mode>Canvas.svelte`, and any new file prefixed with
  the mode name.
- Its own block in `tree-tokens.ts`.
- `e2e/<mode>.spec.ts`.
- `docs/3d-alternatives/<mode>.md`: its notes, decisions, what was tried, and timings on the Simpson
  tree and `representative-551`.

If it needs a change to a shared file, it does not make it. It writes the need into its notes file
under **Needs from Stage 0**; integration resolves it.

### Stage 1 — Ball (`poincare`)

- **Era estimation** (`src/lib/tree-layout/eras.ts`, pure, tested): known eras and relaxation.
  - **Known eras:** a person's era is a single year.
    - It comes from `parseDateValue(birthDate)` bounds, using the midpoint of the lower and
      upper bounds.
    - Without a birth date, it comes from the death date minus a typical lifespan.
    - The original text is never rewritten. `ABT 1900` stays a range internally, and nothing
      fabricates a day.
  - **Bidirectional relaxation:** an iterative solver propagates estimates over the drawn graph's
    bonds, with a fixed iteration cap and convergence tolerance:
    - Parent to child: a child is born about 28 years after a parent, clamped to 15–55.
    - Partner to partner: about 0 years apart, clamped to ±20.
    - Known eras are anchors that never move.
    - The aim: a partner without recorded parents lands in their partner's era, not the 1700s.
    - If nobody in the component has a date, fall back to generation × 28 years around a nominal
      focus year. The view then says that no dates were found.
  - Estimated eras are **layout values only**. The view never shows them as dates. The name
    tooltip shows the real recorded dates, or nothing.
- **Placement** (`poincare.ts`):
  - Y is calendar time: the oldest at the top pole, the youngest at the bottom. Era maps linearly
    onto a latitude of the unit ball, so each slice's disc radius is `R_slice = sqrt(1 − y²)`.
  - Within a slice, households (partners plus their union knot) take an angular sector. Order
    them the way Rings orders households, centred under the unions they came from, so lines stay
    short.
  - Radial position is `r = R_slice · tanh(spread)`. `spread` grows with collateral band and
    sibling order. The focus line sits nearest the axis, and cousins compress toward the glass.
  - Partners share a latitude: the mean of their eras. Any two people in a slice keep a minimum
    angular gap, so nobody overlaps.
- **Scene:**
  - A translucent glass shell with a fresnel-ish rim. Faint latitude rings carry decade or century
    labels, which are real calendar years from the axis, not estimates of anyone.
  - Spheres shrink with `1 − r²`, the conformal factor, so the compression reads as depth.
  - Parent–child lines are hyperbolic geodesics: circular arcs orthogonal to the shell, or straight
    lines through the centre. A Bézier approximation is fine if documented.
  - Camera presets: Angled, Side (time runs top to bottom) and Pole (looking down the time axis).
- **Tests:**
  - Relaxation places the Simpsons' undated partners in their partner's era.
  - Anchors never move.
  - No position falls outside the unit ball.
  - The output is deterministic.
  - Private people's dates are never used for anyone's visible label.

### Stage 2 — Ribbons (`ribbons`)

- **Topology** (`ribbons.ts`): a directed flow from the oldest generation to the youngest. Flow
  runs top to bottom here; Rings puts the youngest at the top.
  - Each person is a **segment** of ribbon from where they enter (their parents' union knot, or the
    top if they have no drawn parents) to their own union knots.
  - For each union, the partners' ribbons converge to a **knot**. Children's ribbons leave the knot
    and fan out.
  - A person with several unions has their ribbon split to each knot in union order.
- **Layout:**
  - Layered by generation along the flow axis.
  - Within a layer, order by a barycentre sweep to reduce crossings. Reuse ideas from
    `crossing-configs.ts` where it fits, without changing that file.
  - Spread in two dimensions across the flow, so the delta has depth, not a flat sheet.
- **Scene:**
  - Each ribbon is a `TubeGeometry` along a `CatmullRomCurve3`. Its radius tapers toward the
    present, and it is coloured by the person's sex token.
  - Partners braid, two tubes twisting around each other over the last stretch, before the knot.
  - The knot is an emissive sphere with a soft glow: an additive sprite, not post-processing.
  - Merge tubes into one `BufferGeometry` per colour group, with a per-vertex person-id attribute
    or a parallel pick-proxy mesh for picking. Without that, about 200 draw calls are too many.
  - Off-line ribbons fade, as on Rings.
- **Tests:**
  - Every drawn person has exactly one entry segment.
  - Every union with two drawn partners has a knot.
  - Children leave their own union's knot.
  - Multiple unions split a ribbon into the right number of branches.
  - Crossings on `representative-551` do not get worse than an unordered baseline.

### Stage 3 — Orrery (`orrery`)

- **Simulation** (`orrery.ts`, pure, deterministic): a fixed number of iterations in the layout
  call, never a live physics loop. The canvas animates only orbital decoration.
  - Initial positions are seeded from a hash of person ids.
  - Forces: repulsion between all bodies (Barnes–Hut once past about 300 bodies), a link spring
    for parent–child, a stiff binary spring holding union partners near `d ≈ 4.0`, and weak
    gravity toward the focus.
  - Children are attracted to their parents' union **barycentre**, the partners' midpoint, not to
    either parent.
  - A person with several unions is the shared star of several binaries. Their partners settle
    around them as a hierarchical system.
  - Stops at a fixed count or when the energy falls below a tolerance. Report the count in
    the notes file.
- **Scene:**
  - Stars are emissive spheres coloured by sex token, with a soft glow sprite.
  - Each union gets a luminous tether between its partners (a fat line with an animated
    gradient, which pauses under reduced motion) and a faint accretion ring at the barycentre.
  - Descent lines run from the barycentre to each child.
  - Optional slow orbital motion of children about their barycentre, purely visual and off under
    reduced motion. Picking and name positions follow it.
- **Tests:**
  - Determinism: the same graph gives identical positions.
  - Union partners end within tolerance of the binary distance.
  - A child is nearer its parents' barycentre than an unrelated star of that generation.
  - The several-unions fixture forms one cluster.
  - Layout time on the Simpson tree and `representative-551` is recorded.

## Stage 4 — integration (this branch)

1. Merge the three mode branches into this branch. Each touches only its own files, so conflicts
   should be limited to its `tree-tokens.ts` block.
2. Resolve every **Needs from Stage 0** note.
3. Run `npm run lint`, `npm test` and the e2e specs for every mode, including rings, controls and
   default-view.
4. Write **ADR-033** in `docs/decisions.md`: the three views, the switcher, the per-mode traits,
   and what was given up. Fold the per-mode notes into it or link them. Update the roadmap and
   slice tables if the owner wants these tracked as a slice.
5. Do not push. Pushing `main` to the cloudflare remote deploys, so the owner decides when.

## Session rules

- **Model:** Sonnet.
- **Commits:** small conventional commits, with the agent's own `Co-Authored-By` trailer.
- **Lint:** `npm run lint` before the last commit.
- **Pushing:** never.
- **Before calling it done:** see the view in the browser preview on the Simpsons and Simpson
  fixtures.
