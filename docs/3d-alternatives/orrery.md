# Orrery (`orrery`): notes

Stage 3 of `docs/3d-alternatives-plan.md`. A force-directed star cluster: each person is a star, a
union's partners are a binary, children settle round their parents' barycentre.

## Files

- `src/lib/tree-layout/orrery.ts`: selection, seeding, springs; returns people, unions (with their
  barycentre and binary distance) and child links.
- `src/lib/tree-layout/orrery-simulation.ts`: the generic force simulation (bodies, springs,
  barycentre links, Barnes–Hut). Knows nothing of people.
- `src/lib/tree-layout/orrery-orbit.ts`: the purely visual drift, a pure function of time.
- `src/lib/components/tree/orrery-scene.ts`, `OrreryCanvas.svelte`, `e2e/orrery.spec.ts`,
  `ORRERY_TOKENS` in `tree-tokens.ts`.

## How the layout works

- **Same people as every view:** `selectFocusSubgraph`, then Rings' grouping of child links (a line
  leaves a drawn union's barycentre, else the parent's own star).
- **Deterministic:** the start position of each person comes from an FNV-1a hash of their id (x and
  z in a square scaled with √n, y at their generation level), never `Math.random`. Positions are
  rounded to 0.001 and translated so the focus is the origin.
- **Forces,** per iteration, with a cooling `alpha` from 1 down to a floor of 0.04:
  - repulsion `7 / (d² + 0.6)^1.5` between all bodies, left out between bound partners;
  - a stiff binary spring (strength 0.32) holding union partners at `d = 4.0`;
  - child to barycentre springs (0.07, rest 5.5), the reaction shared among the partners; a direct
    parent link springs to the parent (0.05, rest 6);
  - weak gravity (0.012) to the focus and a weaker vertical pull (0.035) to the generation's level
    (4.5 units apart, youngest highest as on Rings), so the cluster is loosely stratified.
- **Several unions (hierarchical multi-star):** a person's *n*th union binary is held at
  `4.0 × (1 + 0.35 n)`, so partners nest outward from the shared star instead of piling at one
  distance. Repeated unions between the same two people share one binary (the first one's
  distance), since two springs of different lengths would only fight. Three or more partners in
  one union are chained in `union_partner` order.
- **Iterations:** at most 260 (`ORRERY_ITERATIONS`), stopping early when no body moves more than
  0.002 units. Small trees run all 260, except the 5-person fixtures, which settle at about 250.
- **Barnes–Hut:** implemented (octree, θ 0.9) and tested, but the threshold is **700 bodies, not
  the plan's 300**: measured, the exact pass is faster until roughly 700.

## Timings (vitest on the author's laptop, warm unless noted)

| Graph | People drawn | Layout |
|---|---|---|
| Simpsons, widest focus | 16 | 4 ms (cold) |
| `representative-551` | 5 (the fixture is a 551-line GEDCOM, not 551 people) | 0.2 ms |
| Synthetic dynasty, 7 generations | 254 | 19 ms exact pass; 70 ms on the first, cold call |
| Synthetic dynasty, 8 generations | 510 | 66 ms exact, 145 ms Barnes–Hut |
| Synthetic dynasty, 9 generations | 1022 | 1.2 s exact, 0.37 s Barnes–Hut |

The owner's real Simpson tree is not in the repo, so a synthetic tree of the same size stands in: the
254-person dynasty (a couple, two children per couple, each child partnered by an outsider) is
within the 100 ms target even cold. Check it on the real tree at integration.

## Scene decisions

- **Dark stage** (`ORRERY_TOKENS.stage`): the glow sprites are additive and only read on a dark
  background. The shell's chips (names, legend, controls) are light panels, so they stay readable.
  The cream `RING_TOKENS.stage` behind the canvas never shows.
- Star colours are lighter variants of the sex tokens; the three share the unknown-sex neutral for
  null sex. Private people are a dim grey star with no glow and are not pickable.
- Stars off the focus line are dimmer (emissive and glow), as on Rings; descent lines on the line
  are warm and bright, the rest a dim blue.
- **Tethers:** one merged `LineSegments2` for all unions, 14 segments each, with per-vertex colours
  fading from one partner's colour to the other's. A bright pulse runs along each tether (about 4 s
  end to end, phase from the union id). Under reduced motion the pulse is dropped and the gradient
  is static.
- **Accretion ring:** a faint additive ring at each union's barycentre, radius half the binary
  distance, lying in the horizontal plane through both partners.
- **Descent lines:** one merged `LineSegments2`, barycentre to child, fading toward the child.
- **Drift:** households (people joined by drawn unions) move as rigid groups, so a tether never
  stretches. One member with drawn parents drives the group, rotating about its parents'
  *displayed* barycentre (so orbits nest), at 0.05–0.10 rad/s with a hash-chosen tilted axis.
  When two partners both have drawn parents only one drives, so the other's line up to its own
  parents stretches a little. Picking and names read the same drifted positions (`track` keeps the
  vector by reference). Reduced motion stops the drift and holds the laid-out picture.
- **Draw on demand:** the animator reports "changed" only while drifting; with reduced motion the
  scene draws nothing between interactions.
- `LineMaterial` resolution for the two merged line batches is kept by a `ResizeObserver` in the
  scene, since the stage only tracks lines made by `thickLine`.

## Tests

- `orrery.test.ts`: every test graph draws exactly the selection once each; identical output on a
  second run with the focus at the origin; partners within 40% of their binary distance on every
  captured and synthetic graph (about 2–20% in practice, the rest being child pull); a lone
  couple within 10%; a child nearer its own barycentre than a cousin's; children nearer than the
  median other star of their generation on the Simpsons; the `three-unions` fixture is one
  cluster with binaries stepping outward; Barnes–Hut determinism and similar size; drift starts on
  the layout, keeps binaries rigid and is a pure function of time.
- `e2e/orrery.spec.ts`: opens from the address; names the focus line, All names, refocus,
  Shift+Enter, camera preset, click-through-name picking (with reduced motion on, so the star holds
  still), back to Flat; and that names move while drifting and stop under reduced motion.

## What is rough

- Dense trees (the 254-person dynasty) become a hairball in the centre; the cluster is readable
  mainly through the lit line, the glow and orbiting. No cross-generation separation beyond the
  weak vertical pull.
- Line widths are one per batch, so the focus line is told apart by brightness and colour, not
  thickness.
- The drift is a decoration only; nested rotations make a deep descendant swing in wide arcs.

## Needs from Stage 0

- `ThreeStage` could expose a merged-segments helper (a `LineSegments2` that registers its material
  for resize, like `thickLine`) so the Ribbons and Orrery batches need not each carry their own
  `ResizeObserver`. Optional.
- `ThreeStage.resetWorld` disposes only `Mesh` and `Line` materials, so `Sprite` materials leak
  unless the scene tracks them, as `orrery-scene.ts` does. Disposing `Sprite` and `Points` in
  `disposeWorld` would remove that burden.
- `OrreryCanvas` binds the shell's `scene` and `shouldReduceMotion` (both already `$bindable`) to
  tell the scene about reduced motion; nothing else needed.
