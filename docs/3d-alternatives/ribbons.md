# Ribbons (`ribbons`) — notes

Stage 2 of `docs/3d-alternatives-plan.md`. Lineages are tubes flowing from the oldest generation at
the top to the youngest at the bottom. Partners' ribbons braid into an emissive knot per union and
the children's ribbons fan out from their own union's knot.

## What exists

- `src/lib/tree-layout/ribbons.ts`: pure layout, no three.js.
- `src/lib/components/tree/ribbons-scene.ts` and `ribbons-tubes.ts`: the scene and its tube maths.
- `RibbonsCanvas.svelte`: the shell around the scene. Cameras: Angled, Side, Edge.
- `RIBBON_TOKENS`, `RIBBON_FADE` and `RIBBON_SIZES` in `tree-tokens.ts`.
- `e2e/ribbons.spec.ts`, and `ribbons.test.ts` beside the layout.

## Layout decisions

- **Strands, not edges.** The layout returns `strands`, one per tube:
  - `entry`: exactly one per person, from their parents' union knot, from a lone parent, or (a
    `stub`, drawn short) from above when no parent is drawn.
  - `extraEntry`: a person's further parent links (a child asserted in several drawn unions, or by
    pedigree collapse). Drawn at half radius, so converging lines still show and "one entry each"
    still holds. A union line is preferred as the entry.
  - `join`: from a person to the knot of each union they are a partner in, in union order. It
    carries `braidIndex` and `braidCount`, taken from `union_partner` order.
- **Knot per union, not per couple.** Every drawn union with at least one drawn partner has a knot,
  including a one-partner union with children. Several unions between the same pair are distinct.
  A union is never labelled a marriage anywhere.
- **Rows** are the selection's generations, with y = −generation × 8. A knot hangs 2.6 units below
  its youngest drawn partner.
- **Ordering.** Each row is split into households (partners chained, as on Rings). Households are
  ordered by five barycentre sweeps, each a pass down on parents and a pass up on children.
  Every candidate is placed and its crossings counted, and the **best is kept, with the selection
  order as the first candidate**, so the result is never worse than unordered. Placement keeps
  each row's order: it is a pairwise push, not a re-sort. Crossings are counted by
  `countRibbonCrossings` on the final x coordinates, between strands joining the same two levels.
- **Depth (z).** A household stays in its parents' lane and siblings fan across lanes (2.4 units
  apart). Households with no drawn parents spread over ±5 by an id hash. The hash is the only
  "random" thing and it is seeded from ids, so output is deterministic.
- **Private people** are placed like anyone else. Nothing in the layout reads a date or a name.
  Colours come from `sexColour`, which gives private people a plain neutral. A knot's colour is a
  fixed token, never blended from a partner's, so a private partner's sex cannot leak through it.

## Scene decisions

- **Draw calls:** about 6, whatever the tree size.
  - Two merged tube meshes: the focus line, and everyone else, which is transparent and faded. Each
    is a `TubeGeometry` on a `CatmullRomCurve3`, tapered by rescaling each ring about its centre,
    with per-vertex RGBA colour (a gradient between the knot's warm light and the person's colour).
  - Two merged knot meshes, with the same lit/faded split.
  - One additive `Points` for the knots' glow, using a canvas radial gradient. No post-processing.
  - The focus halos.
- **Braid:** over the last 30–88 % of a join, partners twist about the centre line (1.25 turns, phase
  offset by `braidIndex / braidCount`), meeting exactly at the knot. It works for any number of
  partners, not just two.
- **Picking:** the merged meshes are not pickable. Each non-private person gets an **invisible proxy
  sphere** (shared geometry, `visible: false` material), which `ThreeStage.track` maps back to the
  person. It costs no draw call. Raycasting does not read `visible`, and the e2e spec clicks a node
  through the real scene to prove it. Tubes themselves cannot be picked; only the nodes can.
- **Dark stage.** Additive glow vanishes on the cream background the other views use, so Ribbons
  has its own dark `RIBBON_TOKENS.stage` and a light `RIBBON_TOKENS.focus` (the Rings focus colour
  is dark ink). The shell's name pills and legend are light, and stay legible on it in the preview.
- **Dispose:** `Points`, their material and the glow texture are not freed by `resetWorld`, so the
  scene frees them on each rebuild and in its own `dispose`.
- **No animation.** Nothing pulses, so the on-demand loop stays idle and reduced motion needs no
  special case.

## Timings

Measured in vitest (node, M-series Mac), median of a warm run:

| Graph | People | Strands | `layoutRibbons` | Crossings (swept vs unordered) |
|---|---|---|---|---|
| Synthetic interlocking dynasty, focus in generation 1, 8 generations each way | 200 | 304 | 6 ms (1.7 ms unordered) | 144 vs 297 |

- **`representative-551` is not a 551-person graph.** Its fixture holds 5 people and 2 unions, so it
  cannot exercise ordering. The crossing test builds a seeded, shuffled, interlocking dynasty in
  the test file instead, with three focuses.
- **The Simpson tree is not a fixture,** so it was not timed. The 200-person dynasty is the same size
  as its drawn subset, and it lays out in a few milliseconds against the 100 ms target. Run the
  view on the Simpson tree in the preview before relying on that.
- **Rendering:** drawn once on demand. Orbit cost is the same few draw calls whatever the size.

## Rough edges

- Tubes cannot be clicked, only nodes. There is no tooltip beyond the shell's names.
- The stubs above top-row people are long and thick because the oldest row has the thickest tubes.
- Households far apart in x can make long diagonal strands. A smarter z lane could separate them
  further.
- Unions whose partners sit in different generations hang the knot under the younger one, and the
  elder's join runs long.

## Needs from Stage 0

- `npm install` was needed in this worktree because `three` was missing from `node_modules`. This is
  only a local setup issue.
- `playwright.config.ts` hard-codes port 5179, and `reuseExistingServer: true` silently reuses
  another worktree's server when several sessions run in parallel. The e2e specs were run against
  this worktree's own server through a temporary config outside the repo. Consider making the port
  configurable.
- `webgl-tree.ts` imports `ringLineage` from `rings.ts`, so every mode depends on the Rings layout
  module for its lineage walk. A neutral `lineage.ts` would be cleaner.
