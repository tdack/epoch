# Changelog

Epoch has no tagged releases yet; `main` deploys continuously to Cloudflare. This log groups the
significant changes by week, newest first. It was written retrospectively from the git history, so
it summarises themes rather than listing every commit. Decisions and their reasons are in
[docs/decisions.md](docs/decisions.md); open work is in [docs/backlog.md](docs/backlog.md).

## 2026-11-02 to 2026-11-08

### Changed

- **Overview tab** leads with the family: your starting person and your work, then Jump back in
  and Coming up, which now holds today's birthdays, anniversaries and remembrances, with
  statistics last. It says how many people have a dated birth and links to the data-quality
  report. Latest changes name their author and link to the person, partnership or source. Dates
  show in the reader's own time zone from the first load. The births-by-decade chart meets WCAG
  AA contrast and can be read by keyboard, touch and screen reader.
- **Person page** gathers its charts and views (the tree, ancestors, fan, descendants, hourglass,
  relationship and reports) into a Charts and views card at the top of the side column; on a
  phone and in the drawer it folds closed under the toolbar. Edit and Favourite are a pencil and
  a star beside the name; the toolbar keeps Relationship and Record death, and This is me, Merge,
  Make sub-tree and Delete move under More.

## 2026-10-26 to 2026-11-01: Reports, maps, large imports and GEDZip with media

### Added

- **Reports hub** under Research: family group sheets, ancestor and descendant narratives with
  endnotes, d'Aboville and Henry descendant numbering, relatives lists, pedigree completeness and
  brick walls, claims-and-sources summaries, interview sheets, source usage and place reports, an
  anniversary calendar with iCalendar download, CSV downloads, and a family book built from chosen
  sections.
- **Printing**: tree pages, person pages and charts print without app chrome. The partnership page
  prints as a family group sheet. Charts print as A3 to A0 wall charts, and the flat tree prints
  or downloads as a PDF poster or banner.
- **Overview tab**: the family's span, births by decade, on-this-day and upcoming anniversaries,
  your open tasks, latest changes, and first steps for an empty tree.
- **Maps and geocoding**: place locations with a Photon geocoder and a cache. Places, place pages
  and person pages show maps. `PlaceInput` suggests OpenStreetMap places. A workflow matches
  unlocated places to geocoder candidates, and a review page accepts the matches in bulk.
- **Dates as words** in four formats, chosen per tree, across pages, lists, charts and the tree.
- **Ages** at each event and at death, and children's births and marriages in the life timeline.
- **Privacy**: a recent-death window per tree, and any old fact now means "not living".
- **Quality**: findings for people probably dead (with a one-click death record), people not
  connected to the tree, unlocated places and outlying map points.
- **Large imports**: resumable, chunked upload sessions with per-part CRC-32 checksums, a
  `GedcomImportWorkflow` that runs staged imports as jobs, an hourly cron sweep of expired
  sessions, and a 500 MiB cap per media file.
- **GEDCOM 7 conformance**: a typed spec table, a structural validator and a semantic diff.
  Export writes the header and submitter, short XREFs, `@VOID@` pointers, `CHAN`/`CREA` dates, and
  rewrites retained 5.5.1 lines into valid 7.0.
- **Media objects**: GEDCOM `OBJE` records import and export with their files, link titles and
  order. Files can link to facts and to many records. Replacing a tree's GEDCOM keeps its files
  and relinks them. Unlinked and unresolved files are flagged and can be fixed.
- **GEDZip with media**: a ranged zip reader and a segmented streaming zip writer over R2. A
  `.gdz` imports and exports with all its media, including into a new tree.
- PWA pull-to-refresh, and a header logo that pulses while a page loads.
- `tools/agent-cli` for the lookups and commands agents repeat.

## 2026-10-19 to 2026-10-25: Server loads, accounts, audit log and shared media

### Added

- **Server-side page loads** for every tree page, sharing the API endpoints' access checks.
- **Audit log**: undo any change by id, with paging and filters by person, actor and day.
- **Profiles and accounts**: avatars (imported from Cloudflare Access), an Account page, an
  Administration page, and "Leave Epoch" with a farewell email and a guard for the only owner.
- **Tree management**: one Manage tab row for each tree's administration, tree settings in place
  of the colours page, drag-to-reorder trees and sub-trees, and public or private sub-trees.
- **Members**: each member's home person and "this is me" person. Role changes, joins and leaves
  are logged. Inviters are emailed when an invitation is accepted, and expired invitations are
  pruned.
- **Evidence**: group facts, and citing one source for a fact type on several people at once.
- **Media**: one file links to many records and to partnerships, drag-and-drop upload, HEIC, HEIF
  and AVIF uploads, and PDFs open inline in a new tab.
- `PlaceInput` suggests places in every dialog and filter that takes one.
- **Rate limits** on uploads, imports, CSP reports and anonymous reads of the public tree.
- An installable PWA with a service worker and an offline page.
- Imported `DATE`, `CAUS` and `AGE` sub-lines are kept.

### Changed

- Child tables carry a `NOT NULL` `tree_id`, and every write is scoped by it.
- Children and siblings are ordered oldest first everywhere.
- In the tree, a single click marks a person; a double-click or hold focuses them.
- Heavily used sources and notes merge and delete in resumable steps.
- Export, write scoping and change application are faster on large trees.

## 2026-10-12 to 2026-10-18: Media manager, sub-trees, scoped writes and hardening

### Added

- **Files manager** for each tree: rename, attach, detach, move and delete files, report storage
  use, and sweep orphaned objects. Sources can own files.
- **Sub-trees**: named, undoable lenses on a tree, with `<tree>~<subtree>` addresses. Lists,
  search, graph and counts scope to the lens.
- **Per-tree subdomains** (`<slug>.<zone>`) with `./setup subdomains`, and readable tree slugs in
  addresses.
- **Person page** led by a life timeline, with facts grouped by kind and a parent link's evidence.
  The person drawer docks beside the canvas and can be resized.
- **Event fact details** imported, edited and exported, with retained lines shown on the fact.
- **Appearance settings**: a colour palette per user and a site default, and a reduced-motion
  override.
- A minimap and a "Whole tree" layout in the flat view.
- Bulk dismissal of quality findings.
- Citing a source from the fact and name dialogs, saved in the same change.
- A GEDCOM upload and drop target on an empty tree.
- Workers Builds deployment, configured by `./setup`.
- Every page links to its source code and built commit (AGPL section 13).

### Changed

- **Scoped snapshots**: every mutation plans over only the records it touches instead of loading
  the whole tree.
- Name search uses a dedicated name index.

### Security

- Report-only CSP, HSTS for the serving host, framing headers, and tests that guard the CSRF and
  CORS defaults.
- Per-tree caps on media and staged imports.
- Dependency bumps for security advisories, and a recorded security audit.

## 2026-10-05 to 2026-10-11: WebGL views, setup CLI, GEDCOM 7.0 export and a public tree

### Added

- **WebGL views** built with three.js: Rings, Ball, Ribbons and Orrery. Each has highlighting,
  trace mode, hover cards, partnership and line picking, and a whole-tree scope. They replace the
  experimental Floors and Layers views.
- **App shell**: a tree switcher, a person finder, a More menu, a one-row chart toolbar, and
  off-screen markers and phone framing on the flat canvas.
- **`./setup` CLI**: provisions, reconciles, tags and tears down every Cloudflare resource. It also
  picks Access policies, generates `wrangler.deploy.jsonc`, and includes `doctor`, `allow`,
  `disallow` and a capability spike.
- **GEDCOM**: GEDZip, ANSEL, ANSI and UTF-16 import. GEDCOM 7.0 is the default export, with
  5.5.1 and `.gdz` as options. Loosely typed dates are read and can be standardised in one
  undoable change.
- **Asynchronous exports** for large trees, with resumable downloads and an R2 lifecycle rule.
- **One public tree** per install, readable by anonymous visitors without private people.
- Install-owner admission: signed-in visitors without an invitation are turned away.
- Invitation emails through the Workers `send_email` binding.
- Renaming a tree, and a default view for each member and tree.

## 2026-09-29 to 2026-10-04: The genealogy feature set

### Added

- **Focus-centred tree** with an hourglass layout, expandable stubs, step families, URL state and
  a bounded graph window around the focus person.
- **Append-only change log** with atomic guards: every mutation is logged and can be undone, with
  impact previews, conflict dialogs and undo toasts.
- **Person and partnership pages** with repeatable fact editors, multiple names (with née forms)
  and the X sex value.
- **Merging** duplicate partnerships and duplicate people, with side-by-side review, previews and
  undo. Duplicate families are detected at import.
- **Search** across all names, XREFs, places and dates; paged people, partnership and surname
  lists; favourites and recents.
- **Privacy**: a likely-living calculation, per-person overrides, per-tree thresholds, masking in
  every read, refused writes, and GEDCOM `RESN`.
- **Members and roles**: invitations by email, role changes and removal under one policy.
- **Kinship calculator** for every route between two people.
- **Charts**: pedigree, descendant, fan and hourglass charts, plus text ancestor and descendant
  lists.
- **Places**: derived place records, and undoable rename and merge.
- **Evidence**: sources, repositories, citations and shared notes as records, round-tripped
  through GEDCOM.
- **Data quality** report with dismissals, unsourced facts and duplicate-person suggestions.
- **Research tasks**, including tasks created from quality findings.
- A public welcome page, a `/login` route behind Access, and the Epoch brand mark.
- A Simpsons fixture seed for development.

### Changed

- Event dates store parsed bounds, precision and qualifier.
- Prettier, ESLint (with the boolean naming rule) and knip form the `npm run lint` push gate.
  A Playwright e2e suite runs outside it.

## 2026-09-15 to 2026-09-19: Foundation

### Added

- Initial SvelteKit app on Cloudflare Workers and D1, migrated to SvelteKit 3.
- Phase 0: domain types, typed errors, role-based authorization, a privacy-safe logger,
  Cloudflare Access JWT validation, repositories and optimistic concurrency.
- The neutral data model: `person`, `person_name`, `union`, `union_partner` and `parent_child`,
  with a lossless `date_value`.
- GEDCOM 5.5.1 and 7 import and export that keeps unmodelled structures for lossless round trips.
- Intent-based relationship editing with undo, impact summaries and a relationship graph.
- Zod validation on API payloads.

### Removed

- The gendered legacy `families` and `family_children` tables, replaced by the neutral model.
