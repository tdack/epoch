# Reports and printing: research

- **Date:** 2026-10-26
- **Scope:** Research only. No code, ADR or backlog change. It expands webtrees-comparison.md 1.4
  ("No reports, and no print styles") and the backlog line "Printable reports: family group,
  individual summary, ancestors and descendants. Must be accessible and printable."
- **Question:** What reports do people actually make with genealogy programs? Which should Epoch
  offer, how should they fit its model, and how should printing work for the pages Epoch already
  has?

**Short answer.**

1. **Reports are ordinary pages.** Each one is a route that renders HTML through the existing
   services and `ViewerScope`, with a print stylesheet. "PDF" means the browser's Save as PDF. Do
   not build a PDF engine. Server-side PDF is a later option (section 7).
2. **Start with print styles for the pages that exist.** The person page, the partnership page, the
   ancestor and descendant outlines, and the SVG charts already carry most of the content of the
   classic individual summary, family group sheet, Ahnentafel and descendant reports. One shared
   print stylesheet, plus a few fixes, gives Epoch its first four "reports" (section 6).
3. **Then add the reports nothing in Epoch covers today:** a register-style descendant narrative, a
   kinship list, place and source usage, a printable calendar, and a family book that strings
   sections together (section 4).
4. **The best ideas aren't in webtrees.** A pre-filled **interview sheet** for a living relative, a
   **brick walls** research agenda, and **pedigree completeness** suit a family building a tree
   together better than most of the classic reports do (section 5).

Every report must respect the four constraints in section 3: privacy, the neutral model, readable
dates, and accessibility.

---

## 1. What Epoch has today

| Classic report | Closest thing in Epoch | Gap |
|---|---|---|
| Individual summary | Person page (`PersonView.svelte`): at a glance, Life, Family, Facts, Names, notes and evidence | No print styles. Citations and notes sit in `<details>` disclosures that stay closed in print. |
| Family group sheet | Partnership page (`unions/[unionId]/+page.svelte`): partners with dates, relationship events, notes, evidence, children with each parent link's type, chronology | Missing for a group sheet: each partner's places and parents, and each child's death and partners. |
| Ahnentafel | `AncestorOutline.svelte`, with Ahnentafel numbers | No print styles. No facts beyond the summary line. |
| Descendant report | `DescendantOutline.svelte` | No numbering system (Henry, d'Aboville or Register). No narrative. |
| Pedigree, descendant, fan and hourglass charts | `ChartCanvas.svelte` and `FanChart.svelte`, as SVG with a `viewBox` | They scale to one page already. Nothing tiles a large chart over several pages. |
| Data errors and missing facts | Quality report, with 24 rules, including `unsourced_key_fact`, `probably_dead_no_death` and `unconnected_people` | Screen only. |
| Changes report | Audit log and record history (ADR-068) | Editors and above only (comparison 1.15). |
| On this day and anniversaries | Overview tab | No month or year calendar, and no print layout. |
| Place report | `/place` page for one place | No events listed by place over time. |
| Research log or to-do list | Tasks | No print layout. |
| Relationship chart | `/relationship`, with every route and a sentence | No print layout. |

The repo has no `@media print` rule, and `app.css` has no dark theme, so print only has to undo the
screen layout and the custom colour palette, not a theme.

## 2. What genealogy programs produce

These sources were surveyed: Gramps 5.2 (the best documented), webtrees 2.2.6, Family Tree Maker,
RootsMagic, Reunion, MacFamilyTree and the FamilySearch printable forms. Names for the commercial
programs come from secondary sources and older versions. See section 8.

### 2.1 Record sheets: one person or one family

| Report | Found in | What people use it for |
|---|---|---|
| **Family group sheet** (FGS) | Every program. Gramps "Family Group Report". FamilySearch "Family Group Record" form. | The genealogist's basic unit. One couple, their vital facts and parents, and each child with dates and spouse. Printed and taken to archives, or posted to relatives to fill in. |
| **Individual summary**, "Complete Individual Report" | Gramps, RootsMagic, webtrees | Every fact, name, note and source for one person. Gramps can run it over a filtered set of people. |
| **Fact list and timeline** for one person | FTM "Timeline", webtrees | Facts in date order, often with ages. |

### 2.2 Lineage reports: many generations

| Report | Found in | Notes |
|---|---|---|
| **Ahnentafel** | Gramps, webtrees, all commercial programs | Ancestors numbered 1, 2, 3 and so on, where a father is 2n and a mother 2n+1. |
| **Ancestor narrative**, "Detailed Ancestral Report" | Gramps, RootsMagic, FTM | Ahnentafel order written as sentences, with endnotes. |
| **Descendant narrative** in **Register** or **NGSQ** (modified Register) style | RootsMagic (five descendant styles), Gramps "Detailed Descendant Report", Legacy | Publication standard for US genealogical journals. NGSQ numbers every child. Register numbers only children who have descendants. |
| **Descendant outline** with **Henry** or **d'Aboville** numbering | Gramps, Legacy, webtrees | Henry: 1, 11, 12, 121. d'Aboville separates the generations with dots (1.1.2), which avoids Henry's problem with ten or more children. |
| **End of line** | Gramps | Ancestors with no recorded parents, grouped by generation. This is the brick wall list. |
| **Number of ancestors** | Gramps | Known ancestors per generation against the 2ⁿ possible. Shows how complete the tree is, and pedigree collapse. |

### 2.3 Charts made for paper

- **Wall charts**: ancestor, descendant, hourglass and fan, tiled over many pages or printed as one
  poster (RootsMagic Chart, FTM Charts, Gramps graph reports through Graphviz). Families print
  these for reunions.
- **Relationship chart**: the path between two people (FTM, Gramps "Relationship Graph").
- **Family lines graph**: Gramps, through Graphviz. It shows several branches together.
- **Timeline chart**: lifespans as bars on a shared axis (Gramps, webtrees Lifespans).
- **Calendar**: a month grid of birthdays and anniversaries, optionally with public holidays
  (Gramps "Calendar", webtrees Calendar).

### 2.4 Lists, indexes and statistics

- Individuals index, surname list, and birthday and anniversary lists (FTM "List of Individuals"
  has five formats. Its Contact List of addresses is out of scope for Epoch).
- **Kinship report**: how everyone relates to one person, such as "second cousin once removed"
  (Gramps, FTM).
- **Place report and place usage**: every event at a place, in date order (Gramps, FTM).
- **Source usage and fact sources**: what each source supports (FTM, webtrees "Fact sources").
- **Records report**: oldest person, youngest parent, longest marriage, most children (Gramps).
- **Statistics**: counts by century, sex, age at death and so on (Gramps, webtrees).
- Births, deaths and marriages lists filtered by place and date (webtrees). Occupations and
  cemeteries (webtrees).

### 2.5 Working reports for the researcher

- **Data errors** (FTM, RootsMagic "Problem Alerts", webtrees "Missing facts").
- **Undocumented facts** (FTM).
- **Research log and to-do list** (RootsMagic folders of tasks; FamilySearch's "Research Log and
  Next Steps" form).
- **Tag report** and **note link report** (Gramps).
- **Changes report** (webtrees).

### 2.6 Books and sites

- **Books**: Gramps Books combine several text and graphical reports into one document, with a
  title page, table of contents and alphabetical index, and the settings can be saved and reused.
  FTM and Reunion (from version 11) have similar book builders. Families print and bind these as
  gifts.
- **Narrated web site** (Gramps) and web calendar. Epoch is already the web site, so these don't
  apply.

## 3. Constraints Epoch brings to any report

1. **Privacy is non-negotiable.** A printout or PDF sits outside access control for ever. Every
   report reads through `ViewerScope` and the same masking as the screen. Living and private people
   become the same placeholders the pages show. A report must never be a back door: no "print
   unmasked" option, even for managers, unless it is a deliberate, separately decided feature with
   a warning. A printed report should also carry a footer naming the tree, the viewer's role and
   the print date, so a loose page can be traced and dated.
2. **The neutral model.** A classic FGS has "Husband", "Wife" and "Children". Epoch's version shows:
   - ordered partners with neutral labels
   - each child's `parent_child` type per parent (adoptive, foster, guardian, unknown), which the
     partnership page already does
   - more than one union per person, and derived step relatives
   - union status ("ended by death", "divorced")

   Narrative text must not say "married" unless a `MARR` event exists. It says "had a partnership
   with" or names the event that is recorded. Register-style text ("He married…") needs a sentence
   generator written for the neutral model, not ported from a family-centric program.
3. **Dates read as GEDCOM.** The backlog item "Dates read as GEDCOM everywhere" is a prerequisite
   for any narrative or printed report. "BET 1968 AND 1970" is jargon on screen and worse on paper.
   It is also worse in a sentence: "born ABT 1900 in Ballarat". Do the shared plain-English
   rendering first.
4. **Accessibility.** The backlog line asks for "accessible and printable". That means real headings,
   lists and tables, not absolutely positioned boxes. A tagged PDF comes free from the browser's
   Save as PDF when the HTML is semantic. Charts need the text alternative the backlog already asks
   for. A printed outline is that alternative for a chart.
5. **Pedigree collapse.** A printed pedigree that repeats an ancestor wastes paper and misleads. Use
   the same "also appears as number N" rule that the backlog asks for in charts. Ahnentafel reports
   traditionally print the repeat as "see number 12".
6. **The sub-tree lens.** A report run inside a sub-tree should honour the lens, or say that it
   doesn't, as the Overview does.
7. **Citations.** Narrative and record reports print sources as numbered endnotes. Epoch's
   citations are structured (ADR-051 columns), so endnotes can be generated and deduplicated per
   report. Gramps and RootsMagic both offer this.

## 4. Suggestions, ranked

Ranked by value to a family that builds one tree together, then by cost. Sizes are rough:

- **S:** under a day
- **M:** one to three days
- **L:** about a week

| # | Report | Builds on | Size |
|---|---|---|---|
| 1 | **Print stylesheet for existing pages**: person, partnership, outlines, charts, relationship, quality, tasks. See section 6. | Tailwind `print:` variants and one `@media print` block in `app.css` | S–M |
| 2 | **Plain-English dates**: a prerequisite, already in the backlog | `shared/date-value.ts` | M |
| 3 | **Family group sheet**: a print-first version of the partnership page that adds each partner's birth, death and parents, and each child's death and partners | The partnership DTO, plus a fuller summary for partners and children | M |
| 4 | **Descendant outline numbering** (d'Aboville by default, Henry as an option) and a **Register/NGSQ narrative** built on it | `DescendantOutline.svelte` for the numbers. The narrative needs the sentence generator from section 3. | S for numbering, L for narrative |
| 5 | **Ancestor narrative** (Ahnentafel order, sentences, endnotes) | `AncestorOutline.svelte`, the endnote builder from #4 | M, after #4 |
| 6 | **Kinship list**: everyone visible, with their relationship to you or to a chosen person, sortable | The relationship calculator (`domain/relationship-calculator.ts`) and the self-person link. It needs a single-source walk, not one pair at a time. | M |
| 7 | **Place report**: every visible event at a place and the places within it, in date order | The `/place` page and `place-repository.ts`. A hierarchy is in the maps research. | S–M |
| 8 | **Source usage**: for a source, every fact and person it supports. This is the reverse of a fact's citations. | The source page and the citation repository | S |
| 9 | **Printable calendar**: a month or year grid of day-precision births, partnerships and deaths, plus an `.ics` download | The Overview's on-this-day query | M |
| 10 | **Family book**: pick a person, then tick sections (title page, ancestor narrative, descendant narrative, FGS for each union, photos, index). It renders as one long page with page breaks, a table of contents and an index of names. | #3 to #5. CSS `target-counter()` for TOC page numbers works in print engines but not in browsers, so the TOC lists sections without page numbers. | L |
| 11 | **Records and statistics**: oldest, youngest parent, longest partnership, people per century, age at death | Overview figures, `ViewerScope` | M |
| 12 | **Wall chart**: a pedigree or descendant SVG at poster size, or tiled across pages with overlap marks | The chart SVGs. Tiling means printing the same SVG several times, each with a shifted `viewBox`. | M |
| 13 | **CSV for every tabular report** (kinship, place, source usage, quality, tasks) | The same data the page shows | S each |

Leave out, or defer:

- **Contact lists and address labels** (FTM). Epoch does not store addresses for this.
- **Historical events overlay.** Low value, as comparison 1.7 says.
- **A generic report designer** like webtrees' XML reports. That is a plugin system by another name,
  and plugins are OUT.

## 5. Interesting alternatives

These are less common in desktop programs but fit Epoch's purpose, a family collaborating, better
than the classic set.

- **Interview sheet for a living relative.** Pick a person, such as your grandmother. Epoch prints
  what the tree knows about her and her close family, with blanks and prompts for what's missing:
  "Where was Uncle Jim born?", "Maiden name of your mother?". A missing date or place becomes a
  question. Bring it to the visit, then type the answers in. It is the FGS-by-post tradition turned
  into a prompt. The masking question here: the subject is living, so only a viewer allowed to see
  them can print it.
- **Brick walls research agenda.** End-of-line ancestors (2.2) joined with their quality findings
  and open tasks: "Mary Smith (#13), born about 1820, Cork. No parents, no sources for her birth.
  2 open tasks." This is a to-do list that tells a researcher where to dig next, and a natural way
  to hand work to a collaborator.
- **Pedigree completeness.** For a person, how many of their 2ⁿ ancestors are known per generation,
  as a table and a half-fan heat map. It is cheap, motivating, and shows pedigree collapse
  ("generation 7: 58 of 64, 3 duplicates").
- **Evidence or proof summary for one person.** Each fact with every citation that supports it,
  conflicting values side by side (the `conflicting_births` and `conflicting_deaths` rules already
  find these), and which value was preferred. It is the report a careful researcher shares to
  justify a conclusion.
- **"What changed while you were away"** digest. The audit log filtered to records the viewer can
  see, since their last visit or for a chosen week, as a page they can print or forward. It pairs
  with comparison 1.15 (changes are visible to editors only) and with future moderation.
- **Memorial booklet.** One person's life for a funeral or anniversary: a narrative, a Life
  timeline, photos, and their descendants as an outline. Mostly a print layout of the person page
  with media.
- **Reunion pack.** A descendant wall chart of a chosen ancestor, plus name cards that each give
  "how you're related to [ancestor]". Kinship list (#6) and wall chart (#12) reused.
- **Cousin chart.** The static grid that names relationships ("first cousin twice removed") by
  generations from a common ancestor, filled in for two chosen people. It explains the sentence
  `/relationship` already gives.

## 6. Print stylesheet for the existing pages

One shared block in `app.css`, plus `print:` variants where a component needs them.

**Everywhere:**

- Hide the app header, tree tabs, breadcrumbs (or keep them as one small line), toolbars, action
  buttons, the drawer, toasts and the minimap. Use one utility class (for example `print:hidden`)
  rather than a list of selectors that goes stale.
- Use black on white, remove card backgrounds and shadows, and ignore the custom colour palette.
  Charts keep colour for sex or line type, but must stay readable in greyscale, so line style must
  carry meaning too.
- Use `@page { margin: 15mm }` and `@page :first` as needed. Page numbers and a footer through
  `@page` margin boxes (`@bottom-center { content: counter(page) }`) are confirmed for Chrome 131+.
  Firefox has web-platform tests for them, but this research did not confirm they render. Safari
  was not checked. Treat page numbers as progressive enhancement.
- Use `break-inside: avoid` on a fact group, a family block, a citation and a chart, and
  `break-after: avoid` on headings.
- Links: show the target only where it helps on paper. Use `a[href^="http"]::after` for external
  URLs in sources. Never print the app's own routes.
- Add a footer line: tree name, viewer role and print date (section 3.1).

**Disclosures:** citations and notes on both pages sit in `<details>` (`CitationsDisclosure`,
`NotesDisclosure`), and the drawer's sections are `<details>` whose open state is stored per viewer
(`PersonSection.svelte`). Closed `<details>` print closed. Two fixes:

- CSS: `details::details-content` (Chrome 131+) can be shown in print without touching the stored
  state. Hide the `summary` marker.
- Script fallback: on `beforeprint`, open every closed `<details>` and remember which ones were
  closed. On `afterprint`, close them again and leave `localStorage` alone. `PersonSection`
  persists only in `ontoggle`, so the fallback must not fire that handler. Setting `open` from
  script does fire `toggle`, so it needs a guard flag.

**Per page:**

| Page | Notes |
|---|---|
| Person | Print the page layout, not the drawer. The two-column grid becomes one column. Optionally print evidence as endnotes, not inline. Add a small photo if there is a primary image. |
| Partnership | Already close to an FGS. Drop History, Same partners and Warnings in print. Order: partners, events, children, chronology, notes, sources. |
| Ancestor and descendant outlines | Indent, with numbers. One generation's people shouldn't split from their heading. |
| Charts (SVG) | Fit to the page width, choose landscape with `@page { size: landscape }` on chart routes, and hide zoom controls. A large pedigree becomes unreadable at A4, so offer "generations" before printing, or the wall chart (#12). |
| Tree canvas and 3D views | Out of scope. The backlog already rules out printing 3D. Suggest an outline or chart instead. |
| Relationship, quality, tasks, audit | Plain tables or lists. These are working documents, so they need little design. |

Test with the existing Playwright setup: `page.emulateMedia({ media: 'print' })` with a screenshot,
and `page.pdf()` in Chromium, which also proves the PDF path in section 7.

## 7. HTML, print and PDF

| Option | For | Against |
|---|---|---|
| **HTML with a print stylesheet; the browser's Save as PDF** (recommended) | No new dependency. Privacy is enforced by the same request that renders the page. Accessible and tagged when the HTML is semantic. It works on phones. | No reliable page-numbered TOC. Output varies a little by browser. |
| **Cloudflare Browser Rendering** (`/pdf` endpoint or Puppeteer binding) for a server-made PDF | Consistent output. A book could be generated in a Workflow and stored in R2. Priced per browser-hour: 10 hours a month on Workers Paid, then $0.09 an hour. | The headless browser must load an Access-protected page as the viewer, which needs a short-lived signed render token and a route that trusts it. That is a new authentication path. Better: render the HTML in the Worker (the same SvelteKit render) and send it to Browser Rendering as content, not as a URL. |
| **A PDF library in the Worker** (for example pdf-lib or jsPDF) | No browser involved. | Layout code written twice, and accessibility (tagging) is mostly lost. Not recommended. |
| **Paged.js or Vivliostyle** on the client, which polyfill CSS Paged Media | Real page-numbered TOC, running heads, `target-counter()`. | An extra client library just for books. Consider it only for #10, and only if the TOC without page numbers proves inadequate. Maintenance state not checked. |

Start with the first option. Revisit Browser Rendering only for the family book, if people want a
downloadable file they can send to a printer.

## 8. Not verified

- Exact current report menus for RootsMagic 10/11, Family Tree Maker 2024 and MacFamilyTree. The
  names here come from secondary sources, some from older versions. FTM's "Place Usage", "Data
  Errors", "Undocumented Facts" and "Kinship" reports were confirmed by a 2024 course guide and a
  user's notes page. RootsMagic "Problem Search" was not found by that name.
- Firefox and Safari support for `@page` margin boxes and `::details-content`.
- Browser Rendering's request parameters for HTML content, as opposed to a URL. The pricing is from
  Cloudflare's 2025 changelog, and the product may now be called "Browser Run".
- Whether `DescendantOutline` and `AncestorOutline` already break across pages cleanly. No print
  test was run.
- How the person page lays out at A4 width. Nothing was printed.

## Sources

- [Gramps report list (forum reproduction of the manual)](https://gramps.discourse.group/t/filters-are-great-why-dont-all-reports-use-them/1860/5)
- [Gramps 5.2 manual, graphical reports](https://www.gramps-project.org/wiki/index.php/Gramps_5.2_Wiki_Manual_-_Reports_-_part_4)
- [Gramps Web user guide: reports and Books](https://www.grampsweb.org/user-guide/reports/)
- [Gramps Books: how they are made](https://gramps.discourse.group/t/book-how-is-it-made/2303)
- [Family Tree Maker reports notes (cutlock.co.uk)](https://www.cutlock.co.uk/research/family-tree-maker-notes/ftm-reports/)
- [University of Strathclyde FTM 2024 reports guide (PDF)](https://www.strath.ac.uk/media/1newwebsite/centres/centreforlifelonglearning/documents/Step_by_step_guide_reports.pdf)
- [GeneaMusings: RootsMagic 4 reports series](https://www.geneamusings.com/2009/04/working-in-rootsmagic-4-post-7-creating.html)
- [RootsMagic Essentials comparison (research logs)](https://rootsmagic.co.uk/try-rootsmagic-essentials)
- [Reunion (Wikipedia): book creator](https://en.wikipedia.org/wiki/Reunion_(genealogy_software))
- [Genealogical numbering systems (Wikipedia)](https://en.wikipedia.org/wiki/Genealogical_numbering_systems)
- [FamilySearch downloadable forms](https://www.familysearch.org/help/helpcenter/article/downloadable-forms-for-family-history-center-patrons)
- [Chrome: content in print margins with CSS (Chrome 131)](https://developer.chrome.com/blog/print-margins)
- [MDN: @page](https://developer.mozilla.org/docs/Web/CSS/@page)
- [Cloudflare Browser Rendering pricing](https://developers.cloudflare.com/browser-rendering/pricing/)
- [Cloudflare Browser Rendering pricing changelog, 2025-07-28](https://developers.cloudflare.com/changelog/2025-07-28-br-pricing/)
