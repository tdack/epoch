---
name: Epoch
description: A private family history, shared with the people who help keep it.
colors:
  binding-emerald: '#065f46'
  binding-emerald-lift: '#047857'
  binding-emerald-deep: '#064e3b'
  binding-emerald-night: '#022c22'
  emerald-wash: '#ecfdf5'
  emerald-mist: '#6ee7b7'
  page-cream: '#fcf9f2'
  panel-cream: '#fdfbf7'
  dialog-cream: '#fcfaf5'
  vellum: '#fffbeb'
  field-white: '#ffffff'
  stone-wash: '#fafaf9'
  stone-shelf: '#f5f5f4'
  stone-rule: '#e7e5e4'
  stone-edge: '#d6d3d1'
  stone-faint: '#a8a29e'
  stone-quiet: '#78716c'
  stone-text: '#57534e'
  stone-strong: '#44403c'
  stone-body: '#292524'
  stone-ink: '#1c1917'
  ledger-amber-wash: '#fffbeb'
  ledger-amber-edge: '#fcd34d'
  ledger-amber-ink: '#78350f'
  error-red: '#b91c1c'
  error-wash: '#fef2f2'
  tree-paper: '#f7f3ea'
  tree-dot: '#d6cebf'
  tree-accent-teal: '#0f766e'
  tree-focus: '#0f172a'
  sex-m-fill: '#dbe8f5'
  sex-m-edge: '#5a84b5'
  sex-f-fill: '#f6dde6'
  sex-f-edge: '#b8607f'
  sex-u-fill: '#ebe7e0'
  sex-u-edge: '#7d756a'
  rel-biological: '#44403c'
  rel-adoptive: '#4d7c4f'
  rel-foster: '#a16207'
  rel-guardian: '#475569'
  rel-unknown: '#80858e'
  union-gilt: '#8a5a14'
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'"
    fontSize: '6rem'
    fontWeight: 700
    lineHeight: 1
    letterSpacing: '-0.025em'
  headline:
    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 700
    lineHeight: 1.333
  title:
    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
    fontSize: '1.125rem'
    fontWeight: 700
    lineHeight: 1.556
  body:
    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.429
    fontFeature: "'cv02', 'cv03', 'cv04', 'cv11'"
  body-small:
    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: 1.333
  label:
    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 600
    lineHeight: 1.333
  section-label:
    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 700
    lineHeight: 1.333
    letterSpacing: '0.05em'
rounded:
  md: '6px'
  lg: '8px'
  xl: '12px'
  2xl: '16px'
  card-svg: '12px'
  full: '9999px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  xl: '24px'
components:
  button-primary:
    backgroundColor: '{colors.binding-emerald}'
    textColor: '{colors.vellum}'
    typography: '{typography.label}'
    rounded: '{rounded.lg}'
    padding: '8px 16px'
  button-primary-hover:
    backgroundColor: '{colors.binding-emerald-lift}'
  button-secondary:
    backgroundColor: '{colors.stone-shelf}'
    textColor: '{colors.stone-body}'
    typography: '{typography.label}'
    rounded: '{rounded.lg}'
    padding: '6px 12px'
  button-secondary-hover:
    backgroundColor: '{colors.stone-rule}'
  button-splash:
    backgroundColor: '{colors.vellum}'
    textColor: '{colors.binding-emerald-deep}'
    rounded: '{rounded.xl}'
    padding: '0 28px'
    height: '48px'
  section-card:
    backgroundColor: '{colors.stone-wash}'
    rounded: '{rounded.2xl}'
    padding: '16px'
  list-panel:
    backgroundColor: '{colors.field-white}'
    textColor: '{colors.stone-strong}'
    rounded: '{rounded.xl}'
    padding: '16px'
  field-input:
    backgroundColor: '{colors.field-white}'
    textColor: '{colors.stone-ink}'
    typography: '{typography.body}'
    rounded: '{rounded.lg}'
    padding: '8px'
  dialog:
    backgroundColor: '{colors.dialog-cream}'
    textColor: '{colors.stone-body}'
    rounded: '{rounded.2xl}'
    padding: '24px'
  app-header:
    backgroundColor: '{colors.panel-cream}'
    textColor: '{colors.stone-ink}'
    height: '64px'
    padding: '8px 24px'
  notice-amber:
    backgroundColor: '{colors.ledger-amber-wash}'
    textColor: '{colors.ledger-amber-ink}'
    rounded: '{rounded.lg}'
    padding: '12px'
  count-pill:
    backgroundColor: '{colors.binding-emerald}'
    textColor: '{colors.vellum}'
    rounded: '{rounded.full}'
    padding: '0 6px'
---

# Design System: Epoch

## Overview

**Creative North Star: "The Family Archive"**

Epoch is a well-kept reading room for one family's history. Pages are warm cream paper rather than
white, text is set in archival stone inks rather than grey, and a single deep emerald, the colour of
a cloth book binding, marks the few things that act. The welcome page is the only place the room is
shown literally: a library photograph under an emerald wash, with the mark and the tagline in
vellum. Everywhere else the archive is implied by material and restraint, not by ornament.

The mood is calm and scholarly, warm rather than clinical, and approachable for relatives who are
not researchers. Record pages are dense and quiet: small type, uppercase section labels, bordered
sections, plain links. Detail is welcome; decoration is not. Warmth comes from the cream and stone
palette instead of the white-and-slate of enterprise tools, so the app feels like the family's own.
Touch targets grow on coarse pointers and dialog fields never trigger a phone's zoom, so the people
who visit occasionally are not punished for it.

The tree canvas is the one place colour carries data. There the archive gives way to a chart table:
a slightly darker paper with a dot grid, person cards tinted by a muted sex palette plus a symbol,
and parent-child lines distinguished by line style first and hue second.

**Key Characteristics:**

- Cream paper surfaces (`page-cream`, `panel-cream`, `dialog-cream`); white is reserved for what you
  scan or type into: list panels, tables and fields.
- Stone inks for all text and rules; emerald for action and the brand only.
- One system sans stack at small sizes; hierarchy comes from weight and uppercase labels.
- Flat by default: borders and tonal steps carry structure, shadows mean "floating".
- Light theme only. There is no dark mode.
- Lucide line icons at 14–16px beside labels.

## Colors

A warm neutral archive (cream paper, stone ink) with one emerald voice and a small set of meaning
colours. The UI values are Tailwind v4's `stone`, `emerald`, `amber` and `red` utilities, which are
defined in oklch; the hex here approximates them, and the utility is the source of truth. The cream
surfaces and tree tokens are the project's own hex values.

### Primary

- **Binding Emerald** (`binding-emerald`, Tailwind emerald-800): the primary action fill, the brand
  tile behind the mark in the header, links (`row-link`, `text-link`) and count pills. Text on it is
  `vellum` (amber-50), at rest and on hover; never white.
- **Binding Emerald, Lifted** (`binding-emerald-lift`, emerald-700): the hover state of primary
  buttons, and the one keyboard focus colour of the app chrome (outlines and input focus borders).
- **Deep Binding** (`binding-emerald-deep`, emerald-900) and **Night Binding**
  (`binding-emerald-night`, emerald-950): the splash's background and the gradient wash over the
  library photograph; also the splash button's text. `binding-emerald-deep` is the welcome page's
  `theme-color`; the app shell uses `binding-emerald`.
- **Emerald Wash** (`emerald-wash`) and **Emerald Mist** (`emerald-mist`): the selected or
  keyboard-active row of a menu, and the ring of the person avatar on a record page.

### Secondary

- **Ledger Amber** (`ledger-amber-wash`, `ledger-amber-edge`, `ledger-amber-ink`): notices that ask
  for attention without alarm, such as an import to confirm or a relationship caveat. A wash
  background, a soft amber border, dark amber text.
- **Vellum** (`vellum`, amber-50): text and the mark on emerald, and the splash call to action. It
  is the cream counterpart to the emerald binding.

### Tertiary

- **Error Red** (`error-red`, red-700) on **Error Wash** (`error-wash`): field errors, failed
  searches and overdue tasks. Used as text far more than as a fill.
- **Known exception, orange:** the dialog error strip in `BaseModal` (orange-50, 300 and 900), the
  required-field asterisk in `NewTreeModal` and the upload error in `PersonMedia` use Tailwind
  orange instead of red. It is incumbent, not a second system; new errors use red.

### Tree canvas

- **Chart Paper** (`tree-paper`) with a **Dot Grid** (`tree-dot`): the canvas background.
- **Sex fills and edges** (`sex-m-*`, `sex-f-*`, `sex-u-*`): muted pastel fills with a darker edge,
  always paired with a symbol so colour is never the only signal.
- **Parent-child line inks** (`rel-biological`, `rel-adoptive`, `rel-foster`, `rel-guardian`,
  `rel-unknown`): deliberately avoid blue and pink so a line never reads as a sex; line style
  (solid, dashed, dotted) carries the type first.
- **Union Gilt** (`union-gilt`): union markers and partner lines, a dark gilt that sits apart from
  both sex palettes.
- **Teal Accent** (`tree-accent-teal`): the selected card's edge. **Focus Ink** (`tree-focus`): the
  keyboard focus edge on the canvas, darker than any card edge.

These live in `src/lib/components/tree/tree-tokens.ts` so the contrast tests read the exact values.

### Neutral

- **Page Cream** (`page-cream`): the body background of every page.
- **Panel Cream** (`panel-cream`): the sticky header (at 90% with a blur), toolbars, the tree's
  floating panels and pills.
- **Dialog Cream** (`dialog-cream`): modals and the person drawer.
- **Field White** (`field-white`): text fields, and the list panels and tables of the index pages
  (people, places, sources, search results, members), so what you scan or type into is the
  brightest thing on the page.
- **Stone ramp**: `stone-wash` and `stone-shelf` for section cards and secondary buttons;
  `stone-rule` and `stone-edge` for borders and dividers; `stone-quiet` and `stone-text` for
  metadata, helper text and section labels; `stone-strong` and `stone-body` for body and field
  labels; `stone-ink` for headings and names.

### Named Rules

**The One Binding Rule.** Emerald is the only saturated colour in the chrome. It marks what acts
(primary buttons, links, the selected row, focus) and the brand mark, and nothing else. A second
accent in the chrome is a defect.

**The Paper, Not White Rule.** The page and its chrome are cream; section cards are stone-washed.
Pure white is earned by content you scan or type into: fields, list panels and tables.

**The Line Before Hue Rule.** On the tree, a relationship type is told by line style first and
colour second, and a person's sex by a symbol as well as a tint. Nothing on the canvas depends on
colour alone.

## Typography

**Display Font:** the system UI sans (Tailwind's default `ui-sans-serif, system-ui, sans-serif`)
**Body Font:** the same stack
**Label/Mono Font:** the same stack; `font-mono` appears only for GEDCOM and identifiers

**Character:** one quiet, native sans at small sizes, so the interface reads like a well-set index
rather than a brand. Character variants `cv02`, `cv03`, `cv04` and `cv11` are enabled on the body;
they only take effect where the system font supports them.

### Hierarchy

- **Display** (700, 3.75rem rising to 6rem at `md`, line-height 1, tracking −0.025em): the word
  "Epoch" on the welcome splash only.
- **Headline** (700, 1.5rem, 2rem line): the page title of a record page or a tree view.
- **Title** (700, 1.125rem): dialog titles, truncated to one line.
- **Body** (400, 0.875rem, 1.25rem line): record content, form fields, dialog prose. Prose blocks
  sit inside `max-w-2xl` or `max-w-3xl` columns, about 65–80 characters.
- **Body small** (400, 0.75rem, 1rem line): the workhorse of dense rows, metadata, dates and help
  text. It is the most used size in the app.
- **Label** (600, 0.75rem): buttons, field labels and toolbar controls.
- **Section label** (700, 0.75rem, 0.05em tracking, uppercase, `stone-text`): the heading of every
  section card on a record page.

Text inside the tree's SVG cards uses its own scale: names at 14px bold and dates at 12px in the
standard card, larger when the card is compacted for a zoomed-out view.

### Named Rules

**The Weight Not Size Rule.** Hierarchy inside the app comes from weight (400, 600, 700) and the
uppercase section label, not from large type. Nothing in the app chrome exceeds 1.5rem; the
display size belongs to the splash.

**The Sixteen-Pixel Field Rule.** On a coarse pointer every input, select and textarea renders at
16px or larger, so iOS never zooms when a dialog focuses a field.

## Layout

Two spatial models share the app.

- **Records** (person, union, place, source pages, lists, settings) are a single centred reading
  column, usually `max-w-2xl` (672px) or `max-w-3xl` (768px). A person page opens its wide column on At a
  glance (the newest of each kind of attribute, the rest a click away), then its Life timeline
  and Family, and gathers the rest of the record into one section card beside them; an index page holds a white list panel. The tree shell widens to `max-w-7xl`.
- **The tree** is a full-bleed canvas under the sticky header, with floating toolbar, legend and
  zoom controls in panel cream, and the person drawer sliding in from the right (full width on
  phones, 384px from `sm`).

Spacing follows Tailwind's 4px step: 8px inside dense rows, 12–16px inside cards, 24px inside
dialogs. The header is at least 64px tall and wraps on phones, giving the person finder its own
full-width row. On a coarse pointer, menu rows and header buttons grow to 44px targets
(`coarse:` variant), whatever the screen width.

Breakpoints are Tailwind's defaults (`sm` 640px, `md` 768px, `lg` 1024px). The wordmark beside the
mark appears only from `lg`; below that it stays as a screen-reader heading.

## Elevation & Depth

Flat by default. Structure comes from 1px stone borders and tonal steps between page cream, stone
wash and white. Beyond a hairline, shadows appear only on things that float above the page, and
their size says how far they float.

### Shadow Vocabulary

- **Resting hairline** (`shadow-xs`): primary buttons, the sticky header, the tree's notice bar,
  the person avatar and some dialog controls. Barely there; it separates rather than lifts.
- **Tinted lift** (`shadow-md shadow-emerald-900/15`): the emerald brand tile in the header, so the
  binding colour casts its own shade.
- **Floating panel** (`shadow-md`): pills and controls that sit over the tree canvas.
- **Overlay** (`shadow-2xl`): dialogs and the person drawer, with a backdrop of stone-950 at 40%
  and a light blur.
- **Splash call to action** (`shadow-lg shadow-emerald-950/30`): the one button on the welcome page.

### Named Rules

**The Flat-By-Default Rule.** A surface that sits on the page has a border and nothing heavier than
the hairline. A real shadow means the element floats above the page: a header, a floating
control, a dialog, a drawer.

**The Translucent Chrome Rule.** Chrome that overlays content (the sticky header, the drawer) is
panel or dialog cream at 90–98% with a backdrop blur, so the record scrolls visibly underneath.

## Shapes

Gently rounded, never sharp and never pill-shaped by default. Radius grows with the size of the
thing: 6px for small tags, 8px for buttons and fields (the most used radius), 12px for toolbars,
list panels, notices and the brand tile, and 16px for section cards and dialogs. Full rounding is reserved for
the person avatar, count badges and floating status pills. Person cards on the tree are SVG
rectangles with a 12px corner (14px when collapsed to an initial). Borders are always 1px stone,
except the 2px emerald ring of the avatar and the card frames on the tree (1.75px at rest).

## Components

### Buttons

Calm and solid; one primary per view.

- **Shape:** gently rounded (8px).
- **Primary:** binding emerald fill, white or vellum label at 0.75–0.875rem semibold, 8px × 16px
  padding, a resting hairline shadow. Disabled is 50% opacity.
- **Hover / Focus:** fill lifts to emerald-700. Focus is the shared `focus-ring` utility, a 2px
  emerald-700 outline 2px outside (inset by 2px inside scroll containers).
- **Secondary (`action-btn`):** stone-shelf fill, 1px stone-edge border, stone-body label at 0.75rem
  semibold, 6px × 12px padding, an optional 14px Lucide icon. Hover darkens to stone-rule.
- **Splash:** the welcome page's single button is inverted: a vellum fill, deep emerald label,
  12px radius, 48px tall, with an amber focus outline offset 4px so it shows on the dark photograph.

### Chips

- **Count pill:** a full-rounded emerald pill with an 11px bold vellum number, beside toolbar
  controls.
- **Status pill:** a full-rounded panel-cream pill with a stone border and a floating shadow, for
  transient state over the tree.

### Cards / Containers

Two containers, by job: the section card groups facts on a record page, and the list panel holds
rows to scan on an index page.

**Section card**


- **Corner Style:** 16px (`section-card`).
- **Background:** stone wash on the page cream.
- **Shadow Strategy:** none; see the Flat-By-Default Rule.
- **Border:** 1px stone-rule.
- **Internal Padding:** 16px, opened by an uppercase section label.

**List panel**

- **Corner Style:** 12px.
- **Background:** white, with 1px stone-rule border and stone-rule dividers between rows.
- **Shadow Strategy:** none.
- **Internal Padding:** per row, about 12–16px; a form panel takes 20px.

### Inputs / Fields

- **Style:** field white, 1px stone-edge border, 8px radius, 8px padding, 0.875rem text, a 0.75rem
  semibold stone-strong label above.
- **Focus:** the border turns emerald-700 and gains a 1px emerald-700 ring (`focus-input`); no glow.
- **Error:** a 0.75rem or 11px red-700 message under the field, announced with `role="alert"`.
- **Date input:** free text first, because `ABT 1900`, `BET 1900 AND 1905` and `1912` are all real
  dates, with a picker beside it for exact days; a problem is explained inline under the field.

### Navigation

- **Header:** sticky, panel cream at 90% with a blur and a stone hairline beneath. From left: the
  emerald brand tile with the mark, the tree switcher, the person finder, and the primary "Add
  person" action pushed to the right (icon only on phones).
- **Menus and listboxes (`menu-item`):** hover is a faint stone-shelf tint; the keyboard-focused or
  `aria-selected` row is an emerald wash with an inset 2px emerald-700 outline. Rows are 44px on
  touch screens.
- **Links:** `row-link` is medium-weight emerald text that underlines on hover, for the quiet links
  in record rows; `text-link` is the semibold version for headings and breadcrumbs.

### Dialogs

Native `<dialog>` in dialog cream, 16px radius, a stone border, an overlay shadow and a blurred
stone backdrop, capped at 90% of the viewport height and scrolling inside. The header pairs a 28px
tinted icon tile with a one-line bold title and an 11px subtitle. Warnings inside a dialog use an
orange or amber notice.

### Disclosures

Native `<details>` and `<summary>`, never a scripted accordion. They open with the keyboard and stay
open across reloads of the data. Closed by default, unless the content is the reason the page was
opened.

- **Section fold:** for a long list the visitor has already settled, such as the dismissed findings
  on the Quality page. The summary is the section's title in its heading weight (1.125rem bold
  stone ink), with the count in normal-weight stone-600, e.g. "Dismissed (12)". A 16px Lucide
  chevron in stone-500 replaces the browser marker and turns 90° when open (no turn under reduced
  motion). It has `focus-ring` and is 44px tall on touch screens. The panel inside is the usual list
  panel.
- **Inline aside:** a 0.75rem stone-600 summary ("Why this is flagged") under a heading. It keeps
  the browser marker and holds a sentence or two of explanation.
- **Record annex:** notes and citations beside a fact. The summary is a 14px icon with a count, or a
  claim marker, and turns emerald when open or hovered.
- **Optional form part:** a semibold emerald summary that names what it adds ("Add another source")
  and opens fields beneath.

### Person Card (signature)

The unit of the tree. An SVG card tinted by the muted sex palette with a darker edge and a symbol at
the top left, the name in 14px bold ink, then the birth surname and one line of dates in 12px muted
ink. Hover thickens the edge from 1.75px to 3px; selection turns the edge teal at 3.5px; keyboard
focus draws a 4px near-black edge. The focus person (the centre of the tree) is told by line and
shape alone: a 3px stone-ink frame, a second ink rule just outside it (a mounted-print double rule)
and a small ink "Focus" tab on the top edge. The marks are separate from the frame, so selection
(teal) and hover change the frame without erasing them. Line weights scale with the level of detail.
A private person is shown honestly as a dashed edge, italic name and 70% opacity, never removed
without a trace. Zoomed out, the card compacts to a larger name and dates, then to a single initial.

## Do's and Don'ts

### Do:

- **Do** use page cream (`#fcf9f2`) for the page, stone wash for section cards, and white for
  fields, list panels and tables.
- **Do** keep emerald-800 as the only fill for primary actions, with emerald-700 for hover and focus.
- **Do** open every record section with the uppercase 0.75rem bold stone-600 section label.
- **Do** use the `focus-ring`, `focus-ring-inset`, `focus-input` and `menu-item` utilities instead
  of new focus styles.
- **Do** give touch screens 44px targets with the `coarse:` variant, and keep fields at 16px there.
- **Do** pair every colour on the tree with a second signal: a symbol for sex, a line style for the
  parent-child type, a dashed edge for privacy.
- **Do** add new tree colours to `tree-tokens.ts` so the contrast tests cover them.

### Don't:

- **Don't** introduce a second accent colour in the chrome; amber is for notices and red for errors.
- **Don't** give cards or panels that sit on the page more than the hairline shadow; a real shadow
  means the element floats.
- **Don't** use blue or pink for parent-child lines; they would read as sex.
- **Don't** set app-chrome text larger than 1.5rem; the display size belongs to the splash.
- **Don't** name a global class `.card`, `.btn`, `.link` or `.heading`; components scope those
  names, and a global rule would leak into them.
- **Don't** use a white page background, or white for section cards; white is for fields, list
  panels and tables.
