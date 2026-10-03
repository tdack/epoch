# Prompt: one person view for the drawer and the person page

Hand this whole file to a fresh session.

---

You are working on Epoch (SvelteKit 3 / Svelte 5 / Cloudflare Workers + D1), a private
family-tree app. Your job is to replace the tree's person drawer and the person page, which have
grown into two half-editors, with **one person view built from shared section components** that
renders in two frames: the drawer beside the tree canvas, and the full page.

## Read first

- `AGENTS.md`. Follow it exactly: layering, naming (boolean prefixes), comments explain why,
  `Props` interfaces with TSDoc, colocated tests, small Conventional Commits and its commit
  trailer.
- `docs/architecture-review.md`, step E5 and its status row. E5 was skipped because the two
  screens differ throughout. This work removes those differences on purpose, then does what E5
  wanted.
- `docs/decisions.md`, ADR-006 (layering), ADR-015 (privacy) and the latest ADR number.
- These files:
  - `src/lib/components/tree/PersonDrawer.svelte` and `PersonDrawer.component.test.ts`.
  - `src/routes/trees/[id]/people/[personId]/+page.svelte` and `+page.ts`.
  - `src/routes/trees/[id]/+page.svelte`. Note `selectedPersonId`, `drawerPage`, `navigate` and
    the effect that writes `focus` back into the URL.
  - `src/lib/components/tree/tree-url.ts` (view state in the URL), `tree-editor.svelte.ts` and
    `tree-context.ts`.
  - `src/lib/components/PersonLink.svelte`.
  - `src/lib/shared/person-page.ts` (`PersonPageDto`).
  - The shared classes in `src/app.css`: `section-card`, `section-heading`, `action-btn`,
    `row-link`.
- The e2e specs that touch the drawer or the page:
  - `drawer-relatives`, `partnership`, `duplicates`, `keyboard` and `accessibility`;
  - `facts`, `names`, `privacy`, `person-merge`, `history` and `destructive`;
  - `e2e/support.ts`.

Create branch `feat/person-view` from the latest `main`. The repo needs Node ≥ 24.

## Today's split (verify it before relying on it)

| Capability | Drawer | Page |
|---|---|---|
| Add relatives | ✅ | ✅ |
| Remove relatives; edit or merge partnerships | ✅ | ❌ |
| Upload media | ✅ | ❌ (list only) |
| Names: edit, reorder, set preferred | ❌ (read-only list) | ✅ |
| Facts: edit, reorder, place links | ❌ (read-only "Life Events") | ✅ |
| Privacy, notes, sources and evidence, history | ❌ | ✅ |
| Favourite, merge person, links to charts and the relationship calculator | ❌ | ✅ |
| Record death, edit, delete | ✅ | ✅ |
| Clicking a relative | moves the selection on the canvas | goes to that person's page |

## What to build

### 1. Section components

Put them in `src/lib/components/person/`. Each one renders one part of a `PersonPageDto` and owns
its actions:

- `PersonSummary`: name, initials badge, sex, lifespan, other names.
- `PersonFamily`: parents, partnerships and children, direct children, siblings and step
  relatives. It includes every relative action: add, remove, edit partnership and merge
  partnership.
- `PersonNames`, `PersonFacts`, `PersonNotes`, `PersonEvidence`.
- `PersonMedia`: list and upload. Use the existing `uploadMediaApi`.
- `PersonPrivacy` and `PersonHistory`.
- `PersonActions`: favourite, edit, record death, add relationship, merge, delete, and the chart
  and relationship links.

Each section hides its own actions when the viewer's role doesn't allow them, exactly as the
current screens do. Use `hasMinimumRole`/`isManagerOrAbove`; don't add new rules.

### 2. One way to show a relative

The only real difference between the two frames is what clicking a relative does. Make it one
input to the view, not a fork in every template. For example:

```ts
/** On the canvas a relative is selected in place; on the page it is a link. */
relativeTarget: { kind: 'select'; onSelect: (id: string) => void } | { kind: 'link' };
```

Extend `PersonLink` (or wrap it) so it renders a `<button>` for `select` and an `<a>` for `link`,
with the same text and test ids. Don't add any other per-frame props unless you can't avoid them;
if you add one, say why in its TSDoc.

### 3. `PersonView`

`PersonView` composes the sections and takes a `layout`, `'drawer' | 'page'`.

- **`page` layout:**
  - On wide screens, two columns: record sections (names, facts, notes, evidence, media) on the
    left; family, privacy and history on the right.
  - On a phone, one column.
- **`drawer` layout:**
  - One column, with each section after Summary in a native `<details>`/`<summary>` (no new
    dependency).
  - Family and Facts open by default; the rest closed.
  - Remember which sections the viewer opened in `localStorage`, keyed per section, not per
    person.
  - Wrap every storage read and write in try/catch, and render correctly without storage.

Headings must stay real headings in both layouts (an `<h3>` inside each `<summary>`), so axe and
the e2e role queries still find them.

### 4. The frames

- **The person page** becomes the breadcrumb plus `<PersonView layout="page" relativeTarget={{
  kind: 'link' }} />`, with its dialogs.
- **The drawer** keeps its frame:
  - fixed right panel, `sm:w-96`, full width on a phone;
  - close button and Escape;
  - an "Open full page" link.

  Inside the frame it renders `<PersonView layout="drawer" relativeTarget={{ kind: 'select', … }}
  />`.
- Move the dialogs the page owns (`NameDialog`, `FactDialog`, `PersonMergeDialog`, the
  privacy save) into the sections or into a small host, so they work in both frames.
  - Reuse `tree-editor`'s existing paths for refresh and conflict handling.
  - After any edit in the drawer, the canvas and the drawer must both reload, as relative edits
    do today.

### 5. The drawer belongs in the URL

Add `person` to the tree view state in `tree-url.ts`, beside `focus`, so that:

- opening or closing the drawer survives a reload;
- Back closes it;
- a link to the tree with the drawer open can be shared.

Opening and closing the drawer must use the existing `navigate` path. Opening a person in the
drawer is the kind of change that gets its own history entry. Keep links short: an absent
parameter means "drawer closed".

Don't use SvelteKit shallow routing (`pushState` to `/trees/x/people/y`). The tree page keeps its
view in the query string and rewrites `focus` from `page.url`, so moving the path would fight
that effect and lose the tree's view state. Record this choice in the ADR.

Add `tree-url` unit tests for:

- parsing `person`;
- serialising it;
- omitting it when the drawer is closed.

### 6. Delete the old copies

Once both frames use `PersonView`, delete:

- the drawer's own templates;
- the page's section markup;
- anything knip then reports.

`npm run lint` fails on dead code; keep it clean.

## Rules

- **No API, DTO or schema change** is expected. If the drawer needs data it doesn't load today
  (for example history or privacy), reuse the page's load path, `loadPersonPage` or whatever
  `+page.ts` calls, rather than adding an endpoint. If you do need a new endpoint, stop and
  explain why.
- **No migrations.**
- **`src/routes/privacy-matrix.test.ts` must stay green.** No new endpoints or loads are expected.
- **Test ids:**
  - Keep the existing ones (`siblings`, `parents`, `person-name`, `privacy-panel` and others) and
    their meaning.
  - Where one existed only on one screen, it now exists on both.
  - Don't rename a test id to make a spec pass.
- **Specs:**
  - Update e2e specs only where behaviour deliberately changed:
    - relatives in the drawer now sit inside a section that may need opening;
    - the page gains relative removal and media upload.
  - Add e2e coverage for:
    - editing a fact and a name from the drawer;
    - removing a relative and uploading media from the page;
    - reloading with the drawer open;
    - Back closing the drawer.
  - Add component tests for `PersonView` in both layouts, replacing
    `PersonDrawer.component.test.ts` where the cases moved.
- **Accessibility:**
  - `accessibility.spec.ts` must pass.
  - Keyboard navigation of the canvas must be unchanged (`keyboard.spec.ts` and
    `controls.spec.ts`).
  - When the drawer opens, focus goes to its heading.
  - When the drawer closes, focus returns to the card that opened it, if it is still there.
- **Visuals:**
  - Use the existing palette and the `app.css` classes.
  - Take before and after screenshots of the drawer and the page, desktop and phone, and
    keep them out of the repo.
  - Report any intended visual change.
- **Gate before every push:** `npm run check`, `npm run lint` and `npm test`.
  - If only `union-merge.test.ts` or `union-page-service.test.ts` hit the 5-second timeout, rerun
    them alone and note it. Don't raise timeouts.
- **e2e** (`npm run test:e2e`) is outside the gate, but run the specs listed above before the final
  push.
  - If no Chrome is installed, point Playwright at the installed Chromium through `executablePath`
    *locally, without committing it*.
  - If e2e can't run at all, say so.

## Suggested commits

One step per commit, each passing the gate:

1. `feat(person): relativeTarget on PersonLink, button or link`
2. `refactor(person): section components from the person page` (the page renders them; no visible
   change)
3. `feat(person): family and media sections carry every relative and upload action`
4. `feat(person): PersonView with drawer and page layouts`
5. `refactor(tree): the drawer renders PersonView` (delete the old drawer body)
6. `feat(tree): the open drawer lives in the URL`
7. `test(e2e): editing from either frame; reload and Back with the drawer open`
8. `docs: ADR for the shared person view` (a new ADR in `docs/decisions.md`). In the same commit,
   update E5's status row in `docs/architecture-review.md` to point at the ADR.

Push after each step, or at least after 2, 5 and 8.

## Out of scope

- New person features, such as editing notes or sources inline beyond what the page does today.
- A docked side-by-side layout. `PersonView` should make it easy later, but don't build it.
- Restyling the canvas, the header or the cards.

## Done when

- The drawer and the page render the same `PersonView`, and every action is available in both.
- The open drawer survives a reload and closes on Back.
- Gate green, listed e2e specs run (or their absence noted), everything pushed to
  `feat/person-view`.
- A short summary covering:
  - lines removed;
  - the drawer's default-open sections;
  - any visual change;
  - anything skipped and why.

Do not open a pull request or merge to `main` unless asked.
