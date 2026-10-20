---
version: 1
slug: "src-routes-page-svelte"
primary_target: "src/routes/+page.svelte"
related_targets: []
---

## Scope

The public site at epochgenealogy.app, one page. Mode: Persuade. Visitors are families and
researchers deciding whether to try Epoch, and technical relatives who would install it. The
action is the demo (demo.epochgenealogy.app); the second action is the code and the install.
Proof is the product's own drawing of a family, labelled as synthetic. No invented claims:
no users, testimonials, prices or benchmarks.

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
hourglass, ancestors, fan and relationship. Scrolling a pinned stage morphs every person's card
from one view's shape to the next (cards bend into fan wedges and flatten into the relationship
page's rows), rippling out from the focus person; the chips jump to a view. Narrow screens and
reduced motion get tap-to-switch chips. Every view copies the demo's own rendering (card size,
glyphs, link curves and dashes, union labels, focus tab), so it is the product, not a drawing of
it. It hands off to the 3D clips that follow.
Adaptations from the app, each a setting the app allows or a legibility choice: chart cards and
text are drawn larger for a 1040-unit stage; the hourglass shows two generations each side (the
app's steppers reach it; its default is one); the descendants chart's focus card grows to name
both partners, where the app cuts the line at 22 characters.
Roles and sub-trees (2026-10-20): after the feature groups, a stem drops to "Who can do what", a
five-rung ladder down one 3px emerald line with round nodes, viewer to owner, each rung naming only
what it adds (`ROLES` in `site.ts`, checked against `authorization.ts`, `roles.ts`,
`member-service.ts`, `change-audit.ts` and `visibility.ts` on `main`). No amber: the ladder is the
line, not the action. Below it, #subtrees draws the explorer's family as the app's family view cut
to the Marsh line (William Marsh, his descendants and their partners); the people outside it fade
and grey as the figure scrolls in, the section's one moment, static under reduced motion. Copy
holds that a sub-tree is a lens, not an access boundary (ADR-062), and members-only until a manager
shows it to visitors (ADR-069).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- What the demo shows (assumed: one public tree browsable without signing in).
- Licence: the repository is AGPL-3.0-or-later (`LICENSE`, `package.json` on `main`); the site says
  so in one FAQ answer and nowhere louder.
