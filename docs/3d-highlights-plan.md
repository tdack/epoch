# 3D views: whole tree, highlights and trace mode — staged plan

**Status:** planned 2026-10-09 with the owner. Nothing built yet. Builds on ADR-032 and ADR-033;
record the result as **ADR-035** (ADR-034 is taken by the install-ownership work on another
branch).

Six changes, in all four WebGL views (Rings, Ball, Ribbons, Orrery) unless marked:

| # | What | The owner's words, settled |
|---|---|---|
| 1 | **Whole tree** | A deliberate button. Every person the viewer may see, oldest distant ancestor to youngest descendant, **not anchored to anyone**. |
| 2 | **Select a partnership** | Click a partnership's marker: each partner's ancestors in that partner's own colour (never pink/blue), the partnership's descendants in the descendant colour. |
| 3 | **Trace mode** | Off by default, turned on deliberately. Clicks add or remove people, partnerships and lines; each item gets its own colour; where paths meet, the intersection is marked differently. |
| 4 | **Select a line** | Click a parent–child line: the line, everyone downstream of it (the child and their descendants) at full strength, the path upstream (the parent's ancestors) lighter. Trace items use the same full/light rule. |
| 5 | **Ball only** | The dark stage of Ribbons and Orrery, and a fainter glass shell. |
| 6 | **Rings only** | The dark stage of Ribbons and Orrery. |

Accepted limits:
- Selections and trace mode live in the page, not the address. Whole tree is in the address.
- Partnerships and lines are pointer-only, as spheres are (ADR-032). People stay reachable by
  their name buttons, in trace mode too.
- Picking a line on a phone is fiddly even with a generous hit area.

## Rules for every stage

- **Neutral model.** A union is never labelled a marriage. Partners are not assumed to be one of
  each sex, or to be two. Highlight colours are never the sex colours; spheres keep their sex fill
  and highlights show as halos and line colours.
- **Privacy (ADR-015).** Private people are placeholders. They are never picked, named or
  highlighted, and a path stops at them: tracing never walks through a private person.
- **Pure and tested.** Highlight computation, whole-tree selection and generation numbering are
  pure modules in `src/lib/tree-layout/` with colocated tests against the fixtures in
  `src/lib/tree-layout/fixtures/`.
- **Clearing the highlight stays as built.** Empty space, Escape once no drawer is open, and the
  Focus line switch (ADR-033).
- **No clashes with the other branches.**
  - Do not touch `src/hooks.server.ts`, `src/lib/server/auth/`, the user, member, install or tree
    repositories, `tree-service.ts`, `drizzle/`, `wrangler*.jsonc`, `package.json`, `tools/` or
    `e2e/privacy.spec.ts`.
  - Whole-tree privacy tests go in a new spec file.
  - No migration and no new dependency.
- **Commits.** Small Conventional Commits, each with your own `Co-Authored-By` trailer. Never push:
  a push to the cloudflare remote deploys.
- **Gates.** `npm run lint` (format, ESLint, knip), `npm test`, and the 3D e2e specs. Run them with
  `E2E_PORT=<free port>`, because sibling worktrees use 5179.

## The highlight model (Stage A builds it, everyone uses it)

`src/lib/tree-layout/highlight.ts`, pure:

- **Input: a `KinSource`.** This is the part every layout already has: `people` (`id`, `person`),
  `unions` (`id`, `partnerIds`) and `childLinks` (`childId`, `fromUnionId`, `fromPersonId`,
  `parentIds`). A link's key is `` `${childId}<${fromUnionId ?? fromPersonId}` ``.
- **Sources.** One or more of:
  - `{ kind: 'focus', personId }`: today's focus line. The partners keep the partner mark.
  - `{ kind: 'union', unionId, shouldSplitPartners }`: each partner's ancestors get their own
    palette colour when split (item 2), or the source's colour when not (trace mode).
  - `{ kind: 'link', key }` (item 4).
  - `{ kind: 'person', personId }` (trace mode).
- **Walks.** Every source walks upstream (ancestors) and downstream (descendants) over drawn
  people, never through a private person.
- **Output: a `Highlight`.** Maps from person, union and link to a `Mark`:
  - `colour`
  - `strength`: `'full'` for the item itself and its downstream, `'soft'` for upstream
  - `kind`: `'self'`, `'ancestor'`, `'descendant'` or `'partner'`
  - `isShared`: true when it is on two or more sources' paths, which takes the intersection colour
  - The `Highlight` also carries `isQuiet` (nothing lit: draw everyone alike).
- **Palette.** `HIGHLIGHT_TOKENS` in `tree-tokens.ts`:
  - six trace colours, colour-blind safe and legible on the dark stage, never close to the sex
    colours
  - an intersection colour
  - the descendant colour
  - the partner colour
  - the soft opacity
  - Focus-line colours stay what they are today.
- **Caps.**
  - Trace mode holds at most **6 items**; a partnership or a line counts as one.
  - Compute is not the limit, since each walk is linear in drawn people. The limit is colours a
    viewer can tell apart.
  - A seventh click says so in the announcement and the chip strip, and adds nothing.

## Stage A — shared (one session, first; then frozen)

1. **Highlight model and palette**, as above, with tests:
   - the focus source reproduces today's focus line
   - a split union gives two partner colours
   - a link source is full downstream and soft upstream
   - intersections are shared
   - private people stop walks
   - the cap holds
2. **Picking.**
   - `three-stage.ts` tracks unions and links as well as people.
   - `pick()` returns `{ kind: 'person' | 'union' | 'link', id } | null`.
   - Links are picked through `Line2` raycasting with a pixel threshold of about 6 CSS px, wider
     on coarse pointers.
   - Union and link tracking is opt-in, so a scene works before Stage B wires it.
3. **Shell** (`WebGlTreeShell.svelte`):
   - Selection state:
     - normal mode: person click refocuses; union or line click selects it
     - **Trace** mode, toggled by a button: clicks add or remove items
     - the cleared highlight
   - A **chip strip** for the trace items, each chip with a remove button and the item's colour,
     plus Clear. Escape leaves trace mode, then clears, then closes the drawer, one step at a time.
   - The shell computes the `Highlight` and hands it to `applyLayout(scene, highlight,
     shouldRefit)`, replacing `roles`.
   - The hover card shows the hovered item's mark ("Ancestor of …, traced", "On 2 traced paths").
   - Announcements describe the selection.
   - A **Whole tree** button, pressed while `scope=all`.
4. **Scenes, minimally.**
   - Change the four scenes to take a `Highlight` and light from it at the level they light
     today: lit or faded, plus the focus line's colours.
   - Opt each scene's people into the new picking.
   - Stage B does the real visuals per view; Stage A only keeps them compiling and behaving.
5. **Whole tree: server.**
   - `GET /api/trees/:id/graph?scope=all` with no `focus`.
   - It loads every person in the tree up to `MAX_WHOLE_TREE_PEOPLE = 3000`, with their unions,
     links, names and vitals. Use the focus window's `WindowState` and loading steps in
     `src/lib/server/services/focus-window.ts`, so privacy masks it exactly as the focus window
     does. A repository method lists the tree's person ids in order (chunked: D1 allows 100 bound
     parameters).
   - It returns `isWholeTree: true` and `isTruncated` when the cap stopped it.
   - It goes through the existing `treeHandler` and `requireTreeScope`; do not change them.
   - The service header says nothing loads a whole tree. Update it: this is the one bounded
     exception, recorded in ADR-035.
   - Tests:
     - a restricted viewer never receives a private person's data
     - the cap truncates and says so
     - unconnected families are included
6. **Whole tree: client.**
   - `selectWholeTree(graph)` in `src/lib/tree-layout/whole-tree.ts`, pure, returns the same shape
     as `selectFocusSubgraph` with `focusPersonId: null`:
     - **Generations** are global: a child is one below its lowest parent, partners share a row,
       the oldest row is 0.
     - **Unconnected families** are aligned by their dated members where they have any (median
       birth era to row), else stacked from row 0.
     - **Bands** are all 0. Nobody is collapsed; every person is drawn once.
   - Each `layoutX(graph, focusPersonId, options, index)` gains an optional `selection` argument
     and accepts a null focus. Until Stage B tunes it, a null focus may use an internal anchor
     (the first person of row 0), but it must never mark anyone as focus.
   - Address: `scope=all` in `tree-url.ts` and in `+page.ts`'s fetched parameters. While it is
     set, `focus`, `up`, `down` and the wider groups do not change the fetch.
   - In whole tree, a person click lights that person's line without leaving whole tree or
     fetching. The generation steppers are disabled, with a note why.
   - Leaving: the button again, or switching to Flat, which drops `scope`.
7. **e2e.**
   - Extend `rings.spec.ts` for union and line picking, trace mode with two items and the
     intersection, the cap, and whole tree on and off.
   - Add a new `whole-tree.spec.ts`, including a private person in the tree for a restricted
     viewer.

**Exit:** lint, unit and e2e gates pass, and the views behave as today until something is
selected. Then end with a note listing the final APIs Stage B builds on: `Highlight`, `Mark`,
`HIGHLIGHT_TOKENS`, the stage's tracking calls, and the null-focus contract.

## Stage B — one session per view (in parallel, from Stage A's final commit)

Each session edits **only its own view's files**:

- `src/lib/tree-layout/<mode>.ts` and its test
- `src/lib/components/tree/<mode>-scene.ts` and `<Mode>Canvas.svelte`
- its own block in `tree-tokens.ts`
- `e2e/<mode>.spec.ts`
- notes in `docs/3d-alternatives/<mode>.md`

If it needs a shared change, it writes it under **Needs from Stage A** in its notes and does not
make it. The file names are `rings`, `poincare` (Ball), `ribbons` and `orrery`.

Every view:

- **Lighting from the `Highlight`.**
  - Lines take their mark's colour; soft marks use the soft opacity.
  - Shared marks use the intersection colour and are drawn thicker.
  - People get a halo in their mark's colour, and a double halo when shared. Their sex fill stays.
- **Picking.** Partnership markers and parent–child lines are pickable through the stage; give
  markers a hit target at least as big as a person's sphere.
- **No focus.** The layout handles a null focus and a whole-tree selection of about 300 people (the
  owner's Simpson tree) to 3,000, and stays legible.
- **Gates.** Its own e2e spec covers union and line picking and whole tree. Lint, unit and its e2e
  pass. Look at it on the Simpsons fixture and on a whole tree of about 300 people.

Per view:

- **Rings:** a dark stage (item 6), with discs and plain lines recoloured for contrast. In whole
  tree, one ring per global row, oldest at the bottom as today.
- **Ball:** a dark stage and a fainter glass (item 5), with year labels recoloured. In whole tree,
  height is still calendar time.
- **Ribbons:** knots are the partnership markers; tubes take their mark's colour. In whole tree,
  flow runs from row 0 down.
- **Orrery:** the accretion ring or knot is the partnership marker. In whole tree, gravity pulls to
  the centroid, not a focus, and the simulation stays deterministic.

## Stage C — integration (the orchestrating session)

1. Merge the four branches.
2. Resolve every "Needs from Stage A" note.
3. Run every gate and look at every view on the owner's Simpson tree.
4. Write ADR-035 in `docs/decisions.md`. Append after ADR-034 if that has merged by then;
   otherwise resolve the end-of-file conflict when the other branch merges.
5. Do not push.
