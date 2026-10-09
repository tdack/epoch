# Ball (`poincare`) — notes

Stage 1 of `docs/3d-alternatives-plan.md`. Branch work on top of Stage 0 (`8715a08`).

## What exists

- `src/lib/tree-layout/eras.ts`: one calendar year per drawn person, used only for height.
- `src/lib/tree-layout/poincare.ts`: placement in unit-ball coordinates.
- `src/lib/tree-layout/poincare-geodesic.ts`: exact hyperbolic geodesics (circles orthogonal to the unit sphere, straight when collinear with the centre).
- `src/lib/components/tree/poincare-scene.ts`, `PoincareCanvas.svelte`, `POINCARE_TOKENS`, `e2e/poincare.spec.ts`.

## Decisions

- **Eras.** Anchors are people with a usable, non-private `birthDate` (midpoint of the `parseDateValue` bounds, as a fractional year) or, failing that, `deathDate − 70`. Everyone else starts at the value their nearest anchor implies (BFS), then Gauss–Seidel sweeps set each to the mean of what parents (+28), children (−28) and partners (0) imply, clamped to 15–55 (parent/child) and ±20 (partners). Cap 200 sweeps, tolerance 0.01 year. No dates at all: `focus year 2000 + generation × 28`, `hasDates = false`, no year labels, and the canvas says so (control panel note, visible on phones, and the announcement).
- **Private people.** Their own dates are never read, so nothing about them reaches anyone's height, themselves included. They are placed only from neighbours' data. Tested by changing a private person's birth date and asserting identical output.
- **Partners share a latitude.** Era is averaged over each partnership component (union-find over drawn unions), so a person with several unions shares a latitude with all of their partners.
- **Time axis.** Linear era → latitude, `±0.8` of the ball (the poles are too small to stand on), oldest at the top, at least 150 years of span so two close generations don't fill the ball. Rings every 100 years if the span is ≥ 300, else every 10; only multiples of 100 (and 50 on decade spacing) are labelled. Labels are real years from the axis.
- **Radial position.** `r = R_slice · tanh(spread)`, with `R_slice = sqrt(1 − y²)`. `spread = 0.35 + 0.55·band + 0.10·min(sibling rank, 4)` (sibling rank applies off the focus line only), plus a per-generation shift. The shift is found by bisection so that everyone in the generation fits round their circle: a person needs an angle `4·SPACING·K·R / sinh(2·spread)`, which is the hyperbolic circumference growing exponentially with `spread`. That is the point of the model: wide generations move toward the glass instead of clipping. Never outside the ball: `1 − |p|² = R²/cosh²(spread) > 0`.
- **Sphere size** is `K · (1 − |p|²)` (conformal factor), `K = 0.08`, floored in the scene at 0.13 scene units so the glass end stays visible and pickable.
- **Angles** reuse the Rings approach (households as chains, centred under the unions they came from, oldest generation first, `separate()` copied from `rings.ts` because it is not exported; `circularMean` is imported). Slices are *selection generations*; heights come from eras, so two slices can overlap in latitude, hence a final pass (≤ 30 sweeps, O(n²)) that rotates colliding pairs about the axis only, leaving `y` and `r` alone.
- **Lines** are exact geodesics, 24 segments, drawn with the stage's `Line2`. Union knots are the partners' midpoint.
- **Glass** is two `ShaderMaterial` shells (back face `renderOrder −10`, front face `+10`) with a fresnel-ish rim; faded spheres sort between them. Latitude rings and the axis are hairlines; year labels are canvas-texture sprites freed by the scene (see Needs).
- **Camera presets:** Angled, Side, Pole (a hair off vertical for `OrbitControls`). The framing is the whole ball, not the people, so the glass is never cropped; a tiny tree looks small inside it.

## Timings (layout only, Node, warm)

No Simpson GEDCOM exists in this checkout, so these are synthetic full binary pedigrees with two siblings per couple and a child and partner of the focus person, dated by generation:

| People drawn | Ball | Rings (same input) |
|---|---|---|
| 259 | 24 ms | 9 ms |
| 511 | 76 ms | 28 ms |

`representative-551` is a 5-person fixture despite its name; it lays out in under 1 ms. The O(n²) collision pass is the main cost above 300 people; a grid would remove it if it ever matters. Looked at in the browser on the Simpsons and on a 509-person synthetic pedigree (focus with 7 generations up, 3 down).

## Rough edges

- Stub '+N' markers are not drawn, as on Rings.
- On a pedigree where nearly everyone is on the focus line, the lineage name buttons crowd (same as Rings).
- Geodesic bundles between far-apart slices dive through the centre; correct hyperbolically, busy visually.
- The focus halo is a horizontal torus, like Rings; edge-on in Side.
- Not checked in WebKit.

## Needs from Stage 0

- `ThreeStage.resetWorld` / `dispose` only free `Mesh` and `Line`. A `Sprite`'s material, and any `map` texture, leak. The Ball tracks and frees its own label sprites; if other modes want labels, move that into the stage.
- `playwright.config.ts` hard-codes port 5179; with a sibling session's server already on it, `npx playwright test` fails to start. I ran the specs through a throw-away config on another port. Worth an env override.
- The worktree's `node_modules` was stale (no `three`); `npm install` fixed it. `.dev.vars` (`ACCESS_BYPASS_DEV=true`) was missing too, so the preview 401'd.

## Stage B (highlights)

Done:
- Dark stage (`POINCARE_TOKENS.stage`), glass opacity base 0.05 to 0.012 and rim 0.42 to 0.14, year labels and latitude rings recoloured.
- Scene lights from the `Highlight`: line colours from marks, `softOpacity` for soft marks, shared marks drawn at `sharedLinePx`, sprite halos in the mark colour (second ring in the intersection colour when shared). The sex fill stays.
- `trackUnion` with an invisible hit sphere at least as big as the largest partner; `trackLink` on each geodesic (never for private people).
- Layout: the collision pass uses a spatial grid. Whole tree on a 3,140-person synthetic tree (Simpson x10): about 8 s before, about 0.6 to 2.5 s after (machine was loaded). Simpson (314): about 80 to 200 ms.
- Looked at in the browser: Simpsons focus view and Simpson whole tree (legible). Not looked at: trace mode, the 3,000-person render (the browser pane was hidden), the Side and Pole cameras on the dark stage.

Not done:
- `e2e/poincare.spec.ts` union and line picking and whole-tree cases, and the e2e runs.
- `npm test` and `npm run lint` over the whole repo (only my files were linted).
- Rendering cost at 3,000: every line is its own `Line2`, so thousands of draw calls. Unmeasured.

Needs from Stage A: nothing so far.
