---
version: 1
slug: "src-routes-page-svelte"
primary_target: "src/routes/+page.svelte"
related_targets: []
---

## Scope

The public site at epochgenealogy.app: the home page (`src/routes/+page.svelte`) and four detail
pages in the same design, `/roles` and `/sub-trees` (2026-10-22), `/reports` and `/maps`
(2026-10-28). Mode: Persuade. Visitors are
families and researchers deciding whether to try Epoch, and technical relatives who would install
it. The action is the demo (demo.epochgenealogy.app); the second action is the code and the install.
Proof is the product's own drawing of a family, labelled as synthetic. No invented claims:
no users, testimonials, prices or benchmarks.

Home page order (2026-10-22, after the critique): why, the explorer, features, the 3D views, get
the code, install, FAQ, then the close. Roles and sub-trees are second-order depth, so they left
the home page; the features section ends with a sentence linking to them and to reports and maps.
The nav follows the home order (Explore, Features, 3D Views, Get the code, Install, FAQ) and ends
with the pages of their own: Reports, Maps, Sub-trees, Roles. With ten links it folds into the Menu
below 1140px. Its in-page links are `/#…`, so they work from the detail pages, which share the nav, the
close and the footer (`SiteFooter`) and open with a compact emerald header (`PageHeader`).

## Direction contract

THESIS: The page follows the Epoch mark down the page. The generation before (faded) carries the
why, the partners' union carries the features, and the amber child is the action. It refuses the
split hero and the row of equal feature cards.

OWN-WORLD: The app's world, unchanged: emerald binding (#065f46 to #022c22), vellum text on it,
cream paper, stone inks, the one amber (#fbbf24) kept for the child and the action, the system
sans, 12–16px radii, and the library photograph under an emerald wash. The connectors are 3px lines
with round nodes.

STORY: Visitors see a private family history that the family runs itself. They watch it draw a
family honestly (several parents, partnerships, ABT dates), then explore the demo, get the code,
or install it with `./setup`.

FIRST VIEWPORT: The library photograph under an emerald wash, nav on top. The mark at page scale:
faded ancestor T-bars in the two side columns drop to vellum partner discs, and a thick union rule
joins them. "Epoch" (6rem) and the tagline sit centred between the ancestors. The stem drops from
the union to an amber pill, "Explore the demo tree", with the install link beneath it.

FORM: Descend the mark, ranked #1 of 6 grounded structures (dealt index 1; the user locked it).
seed: none (the original roll printed no SEED REFERENCE; `--check-seed none` deals a fresh roll
rather than verifying, and the structure was the user's own pick, so no key is recorded). Code-led: no image generation; the Design canvas "Epoch Website" is the
sketch. Signature interaction: the hero mark assembles on arrival (ancestors, partners, union,
stem, action), the connectors between sections draw on scroll, and the explorer (overdrive,
2026-10-17) redraws one invented family as each 2D view the app has: family view, descendants,
hourglass, ancestors, fan and relationship. It plays like a highlights reel (2026-10-21, after
Apple's "Get the highlights"): the view's caption sits above the drawing, and under it a stone
tray holds one pill per view beside a round Play/Pause. A visually hidden live region says "Now
showing" and the view's name when it changes. Each view holds for 7s while an emerald fill
sweeps across its pill, the name turning vellum as the fill passes, then every person's card morphs
to the next view's shape (cards bend into fan wedges and flatten into the relationship page's rows),
rippling out from the focus person. It starts the first time the drawing is in sight, waits while
it is off screen or the tab is hidden, stops on the last view with Replay, and stops for a reader
who pans the drawing. Phones get dots with 44px targets (38px at 320px wide), the playing one a
filling capsule; the drawing keeps a 960px minimum width and scrolls, and stops where no card is
cut by the frame's edge. Reduced motion starts
paused and switches views without the morph. The scroll-pinned stage it replaced is gone. Every view copies the demo's own rendering (card size,
glyphs, link curves and dashes, union labels, focus tab), so it is the product, not a drawing of
it. It hands off to the 3D clips that follow.
Adaptations from the app, each a setting the app allows or a legibility choice: chart cards and
text are drawn larger for a 1040-unit stage; the hourglass shows two generations each side (the
app's steppers reach it; its default is one); the descendants chart's focus card grows to name
both partners, where the app cuts the line at 22 characters.
Roles and sub-trees (2026-10-20; moved to their own pages 2026-10-22): `/roles` is "Who can do
what", a five-rung ladder down one 3px emerald line with round nodes, viewer to owner, each rung
naming only what it adds (`ROLES` in `site.ts`, checked against `authorization.ts`, `roles.ts`,
`member-service.ts`, `change-audit.ts` and `visibility.ts` on `main`). No amber: the ladder is the
line, not the action. `/sub-trees` draws the explorer's family as the app's family view cut to the
Marsh line (William Marsh, his descendants and their partners); the people outside it fade and grey
as the figure scrolls in, the page's one moment, static under reduced motion. On a phone the
figure scrolls sideways inside its frame, with an edge fade, so its names stay legible. Copy holds
that a sub-tree is a lens, not an access boundary (ADR-062), and members-only until a manager shows
it to visitors (ADR-069). Page copy is `ROLES_PAGE` and `SUBTREES_PAGE` in `site.ts`.

Reports and maps (2026-10-28): the app gained reports, printing and OpenStreetMap maps, so each
has a page. `/reports` ("Reports and printing") pairs its two paragraphs with the sample family's
view drawn as the printed poster: a white sheet cut to the drawing with the app's print footer, and
printer's dimension rules beside it, the short side "up to 841 mm", the long side running on dashed.
Below it the reports sit on two shelves (the person's long list against the partnership and the
whole tree), then an emerald-950 band lists how things print. `/maps` ("Places and maps") draws
Ellen Marsh's life as the person page maps it, numbered stops joined by a line, on a plain
graticule at the real towns' positions, so the site loads no tiles; under it, what a place search
sends and never sends. `MarshDrawing.svelte` is the family drawing both the sub-trees figure and
the poster use, 760 units wide since dates read as words ("between 1908 and 1910"), as the app's
charts now show them. The explorer's dates are in words too. Copy is `REPORTS_PAGE`,
`REPORT_GROUPS`, `PRINTING`, `MAPS_PAGE`, `MAP_PRIVACY` and `MAPS_NOTE` in `site.ts`, checked
against ADR-078, ADR-080 and the reports hub on `main`.

Colour and buttons (2026-10-22): amber marks the action and the child, nothing else. The primary
action, opening the demo tree, is the amber pill (`.button.action` in `app.css`) in the hero, the
features aside and the close; every other link-button is the quiet vellum outline (`.button.quiet`).
The install steps are numbered in emerald, one ledger row each. Section bands are page cream or an
emerald ground, never the neutral `stone-shelf` grey. Type uses the `--site-*` ramp in DESIGN.md.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- What the demo shows (assumed: one public tree browsable without signing in).
- Licence: the repository is AGPL-3.0-or-later (`LICENSE`, `package.json` on `main`); the site says
  so in one FAQ answer and nowhere louder.
