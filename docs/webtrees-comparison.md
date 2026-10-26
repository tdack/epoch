# Epoch vs webtrees: feature gap analysis

- **Date:** 2026-10-26
- **Epoch:** `main` at `d2a125b1`
- **webtrees:** release 2.2.6. The inventory comes from `app/Module/*` (about 120 modules, not counting languages), `app/Http/RequestHandlers/*` (about 330 handlers) and `resources/views/admin/trees-{privacy,preferences}.phtml`. The behaviour claims were checked against the 2.2.6 source, including `Individual::isDead()`.
- **Excluded:** i18n. The 70+ `Language*` modules are left out at your request.

Each webtrees capability is put in one bucket:

| Tag | Meaning |
|---|---|
| **HAS** | Epoch has it, sometimes in a different form |
| **PARTIAL** | Epoch has part of it |
| **GAP** | Missing, and not in `docs/backlog.md` |
| **BACKLOG** | Missing, and already in `docs/backlog.md` |
| **OUT** | Out of scope according to `architecture.md` |
| **N/A** | Not needed by design: Access replaces it, or there are no plugins or themes |

---

## 1. Significant deficiencies, ranked by fit with Epoch's purpose

These are ranked against what PRODUCT.md says Epoch is for: one private tree that a family builds together, with privacy first.

### 1.1 Living-person inference hides far too much (a deliberate ADR-015 choice worth revisiting; high impact)

**What Epoch does.** `isLikelyLiving` (`src/lib/server/domain/living-state.ts`) treats a person as living unless they have a `DEAT`, `BURI` or `CREM` fact, or a `BIRT`, `CHR` or `BAPM` dated before the cutoff. No other evidence counts.

**What webtrees does.** `Individual::isDead()` in 2.2.6 counts a person as dead in any of these cases:

- **Any** of their own dated events is older than `MAX_ALIVE_AGE`. This includes a marriage, residence, census or occupation.
- A parent has an event older than `MAX_ALIVE_AGE + 45` years.
- A marriage is older than `MAX_ALIVE_AGE - 10` years.
- A spouse has an event older than `MAX_ALIVE_AGE + 40` years.
- A child has an event older than `MAX_ALIVE_AGE - 15` years.
- A grandchild has an event older than a similar threshold.

**This was a deliberate choice.** ADR-015 names webtrees' wider rule and chooses own-birth-only so that Epoch "errs toward private". So this item asks you to revisit a decision, not to fix a bug. Any change makes people who are hidden today visible to contributors and viewers. That needs your decision and an ADR amendment.

**Effect.** In a typical imported tree, many 18th- and 19th-century ancestors have only a census or marriage date, or nothing at all. Epoch hides every one of them from contributors and viewers.

Public visitors are not affected: on a public tree only an explicit `private` override hides anyone (ADR-041). The gap is in the signed-in restricted roles.

That undercuts the "anyone with access understands the tree" goal more than any missing chart does. The backlog item "Relationships through a private ancestor are hidden" is largely a symptom of this rule.

**Possible change, in two steps:**

1. Count any own dated fact older than the cutoff, not only a birth. This needs the same change in `isLikelyLiving` and its SQL twin in `repositories/visibility.ts`. A test already holds the two to the same answers.
2. Add relatives' dates with webtrees' offsets. This step is costlier in SQL. ADR-015's stored-column plan (`has_death`, `birth_upper`) is where it belongs.

### 1.2 Contributor changes are live, with no moderation (BACKLOG, emphasised)

A `contributor` has `record:create` (`src/lib/server/auth/authorization.ts`), and what they create goes live immediately.

In webtrees, moderation is the core collaboration flow. The handlers are `PendingChanges`, the `PendingChanges{Accept,Reject}{Change,Record,Tree}` set and `PendingChangesLog*`. There is also a per-user "Automatically accept changes made by this user" setting (`AUTO_ACCEPT` in `users-edit.phtml`).

Epoch's change log, preview and undo (ADR-007, ADR-068) are a strong base for this: a pending change is a planned mutation that has not been applied yet. Given PRODUCT.md's emphasis on "collaboration and change review", this is the largest structural gap that is already known.

### 1.3 Privacy controls are coarse (GAP)

Epoch has three controls:

- `maxAliveYears`
- `shouldShowPrivateStructure`
- a per-person `auto`, `public` or `private` setting

webtrees 2.2.6 (`trees-privacy.phtml`) also has these, which Epoch lacks:

| webtrees setting | What it does |
|---|---|
| `KEEP_ALIVE_YEARS_BIRTH`, `KEEP_ALIVE_YEARS_DEATH` | Keep someone private if they were born or died recently. webtrees' help text says privacy laws in some countries cover the recently dead. |
| `HIDE_LIVE_PEOPLE` | Showing living people to visitors is an opt-in, with a warning that it overrides every other restriction. In Epoch, making a tree public (ADR-041) shows living people automatically. |
| `SHOW_LIVING_NAMES` | Show a private person's name but nothing else. |
| `SHOW_DEAD_PEOPLE` | Choose whether visitors or members see the dead. |
| Per-record and per-fact-type restrictions | Rules such as "hide every `SSN`", "hide every `OCCU` from visitors" or "this source is members only". The access levels are visitor, member, manager and hide-from-everyone. |
| `RESN locked` | Stop edits to a record. Epoch keeps a fact-level `RESN` verbatim and does not act on it. "Decide what a fact-level RESN should do" is in the backlog. |
| Relationship-path privacy (`RELATIONSHIP_PATH_LENGTH`, set per user in `users-edit.phtml`) | A member sees only living relatives within N steps of their linked individual. Epoch already stores a self-person and has a relationship calculator to build on. |

Of these, the recent-death window and "show names only" are the cheapest. They touch only the cutoff and the mask.

### 1.4 No reports, and no print styles (BACKLOG for reports; the print gap is new)

webtrees ships 16 report modules that produce PDF or HTML:

- Ahnentafel, pedigree, descendancy and related-individuals reports
- Family group sheet
- Individual and individual-families reports
- Births, deaths, marriages, and births/deaths/marriages together
- Occupations, cemeteries and changes
- Fact sources
- Missing facts

Epoch has none. The repo has no `@media print` rule anywhere either, so printing a person page or a chart gives you the screen layout.

### 1.5 No calendar, anniversaries or "on this day" (GAP)

webtrees has a Calendar page with day, month and year views (`CalendarPage`, `CalendarEvents`). It also has these modules:

- `UpcomingAnniversariesModule`
- `OnThisDayModule`
- `YahrzeitModule`
- `ShareAnniversaryModule`, which exports an anniversary as `.ics`

Backlog has "Anniversaries, recent changes and basic statistics" as a single line. A calendar page is not mentioned.

### 1.6 No statistics (BACKLOG, as one line)

webtrees has `StatisticsChartModule`, with dozens of charts: by century, sex, age at death, age at marriage, number of children, place, and surname or given name. It also has the `FamilyTreeStatisticsModule`, `TopSurnamesModule` and `TopGivenNamesModule` blocks. Epoch shows people and union counts in the header (`AppHeader.svelte`), and nothing else.

### 1.7 The person page doesn't show context (GAP)

webtrees' individual page gives each person context in several ways. Epoch has none of them:

| webtrees feature | Status in Epoch |
|---|---|
| A **computed age** at every event, such as "(aged 34)" | Missing. Epoch shows only an imported GEDCOM `AGE` line (`PersonFacts.svelte:233`). |
| **Events of close relatives** in the facts tab, each one a configurable preference: the birth, marriage and death of a child, grandchild, sibling, parent, grandparent and spouse | Missing. The backlog lists only "children's births". |
| **Age of parents next to a child's birth date** | Missing. |
| **Historic events** overlay (`*HistoricEvents` modules: monarchs, presidents, social history) | Missing. These are low value for Epoch. |
| **Estimated birth and death dates** where none are recorded | Missing. |

### 1.8 No media thumbnails, albums or slideshows (BACKLOG, mostly)

webtrees has the following, and Epoch has none of it:

- Thumbnails, through `MediaFileThumbnail` and `AdminMediaFileThumbnail`
- Watermarks for visitors
- Thumbnails shown in charts and family groups
- `AlbumModule`, `SlideShowModule` and `MediaListModule`
- Media objects that hold several files, each with a title and type

Epoch serves the original bytes for every preview. The Files list renders each image from its `previewKey`, which is the stored original, so a 20 MB scan in the list costs 20 MB. Watermarks and thumbnails in charts are not in the backlog. Galleries and thumbnails are.

### 1.9 Places have no hierarchy, `_LOC` records or pedigree map (PARTIAL; the rest is BACKLOG)

webtrees has the following:

- `PlaceHierarchyListModule`, which lets you drill down from country to state to town
- `LocationListModule` and `_LOC` records
- The `PlacesModule` tab and `PedigreeMapModule`
- `MapData*` admin pages with CSV and GeoJSON import and export
- Four geocoders and five map providers

Epoch's places are a flat list derived from the text on each fact (ADR-018, ADR-019). Since
ADR-078, a place can have a location. It comes from a fact's GEDCOM `MAP`, is set by hand, or is
picked from OpenStreetMap through Photon, which also suggests places while you type. The Places
tab shows located places on a map, with clustering. The place page has a pin, and the person page
has a life map of the person's facts. Epoch offers Photon for geocoding and OSM tiles for maps, by
design (ADR-078).

Still missing: hierarchy, `_LOC` records, the pedigree map, and map data import and export.

### 1.10 Search is shallow (PARTIAL; part is in the backlog)

Epoch searches names, plus a place substring and a year range (`src/lib/shared/search.ts`). webtrees has more:

| webtrees search | In Epoch |
|---|---|
| `SearchGeneral`: across individuals, families, sources, repositories, notes and places, including note text | GAP for the record types beyond people. Note and source text search is in the backlog. |
| `SearchAdvanced`: any fact field, such as "OCCU contains miner" or "DEAT:PLAC = Ballarat", plus parents' names | GAP |
| `SearchPhonetic`: Russell Soundex and Daitch-Mokotoff | BACKLOG |
| `SearchReplace`: across names, places or everything | GAP. Epoch's place rename covers the place case only. |

### 1.11 Associations (`ASSO`) are kept but never shown (GAP)

Godparents, witnesses and informants are imported and written back out, but they are never displayed or editable (`parser.ts:669` retains them as unmodelled lines). webtrees shows associates on the facts tab of both people. This is genealogically meaningful data that is currently invisible.

### 1.12 Some event and fact types are missing (GAP)

**Partnership events.** The importer already reads `MARB`, `MARC`, `MARL`, `MARS`, `DIVF`, `CENS` and `EVEN` as partnership events (`FAMILY_EVENT_TAGS` in `gedcom/parser.ts`). The editor offers only `MARR`, `DIV`, `ENGA`, `ANUL` and `_SEPR` (`shared/union-events.ts`). So these imported events cannot be added by hand:

- `MARB`: marriage banns, very common in parish-register research
- `MARC`, `MARL` and `MARS`: marriage contract, licence and settlement
- `DIVF`: divorce filed
- `EVEN`: a custom event
- `CENS` on a family

I did not check how the partnership page shows the imported ones. `RESI` on a family is not in the importer's set.

**Person facts.** These are not in the importer's set (`INDIVIDUAL_EVENT_TAGS`), so they are kept as lines but are not facts. You cannot see them or add them:

- `NATI`: nationality
- `CAST`: caste
- `_MILT`: military service, written by webtrees and other programs
- The LDS ordinances (`BAPL`, `CONL`, `ENDL`, `SLGC`, `SLGS`)

### 1.13 Bulk data tools and the record toolbox are thin (PARTIAL)

| webtrees | Epoch |
|---|---|
| `FindDuplicateRecords`: across individuals, families, sources, repositories, notes and media | PARTIAL. People and partnerships are covered by quality rules (`possible_duplicate_person`, `duplicate_partnership`). Sources, notes and repositories are not. |
| `MergeRecords` for any record type, and `MergeFactsPage` | PARTIAL. Epoch merges people, partnerships, sources and notes. There is no repository merge (no route exists) and no fact merge. |
| `UnconnectedPage`: people not connected to a given person | GAP. The whole-tree layout already finds connected components (`tree-layout/whole-tree.ts`). |
| `CheckTree`: GEDCOM and link errors | HAS. The quality report covers more ground. |
| `ModuleDataFix*`: Fix missing deaths, place names, name slashes and spaces, name tags, duplicate links, and search and replace, each with a preview and "update all" | PARTIAL. Epoch has date standardisation and place rename and merge. The useful missing fix is "mark as dead": add `DEAT Y` to people the dates show must be dead, which pairs with 1.1. |
| `EditRawRecord` and `EditRawFact` (raw GEDCOM), and a per-tree "Allow users to see raw GEDCOM" setting | GAP. A read-only raw view is cheap, because the export serialiser exists. Raw editing conflicts with the neutral model and should not be added. |
| `CopyFact`, `PasteFact` and the clipboard | PARTIAL. Group facts (ADR-071) cover the main use. |
| `ReorderChildren` and `ReorderFamilies` | GAP. Children are always sorted by birth (`shared/birth-order.ts`), so undated children and twins cannot be ordered by hand. Names, facts, citations and notes can be reordered. |
| `MergeTreesPage` and `SynchronizeTrees` | PARTIAL. The import has a `merge` mode into an existing tree. Tree-to-tree merge is missing. |
| "Surname tradition": the new relative's surname is filled in | GAP. The new person's surname always starts empty (`RelationshipModal.svelte:88`). |

### 1.14 Home page and communication (GAP, except the dashboard)

webtrees' tree and user home pages are made of configurable blocks:

- Welcome, login, news, journal and FAQ
- HTML and stories
- Recent changes, statistics, top surnames and anniversaries
- Favourites, logged-in users and the slideshow

Its users can also message each other (`MessagePage`, `ContactPage`, `BroadcastPage`, `UserMessagesModule`). Epoch has a "Home dashboard" item in the backlog. It has nothing for stories, news or messages.

Stories deserve a mention: `StoriesModule` attaches narrative prose to a person, and families value it highly. Epoch's shared notes could carry this content. Displaying a note on the person page as a story is mostly a UI change.

### 1.15 Recent changes for non-editors (GAP)

Reading the change log, both the tree-wide log and the audit page, needs `record:edit`, so it is for editors and above (`change-log-service.ts:183`). Contributors and viewers cannot see it. webtrees' `RecentChangesModule` block and `ChangeReportModule` show recent changes to anyone who can see the records concerned.

### 1.16 Exports and branches (BACKLOG)

webtrees has a clippings cart (`ClippingsCartModule`) that collects a person with their ancestors and descendants and exports them as GEDCOM or a zip of media. Its exports can be privacy-filtered by access level (visitor, member or manager), and can be downloaded to the client or saved on the server.

Epoch exports the whole tree only, and only managers may export. Both gaps are in the backlog.

---

## 2. Quick wins

Each item reuses code that exists today. I checked each reuse point. Rough sizes:

- **S:** under a day
- **M:** one to three days

| # | Win | Reuses | Size |
|---|---|---|---|
| 1 | **Any old dated fact means not living**: the first step of 1.1. This makes people who are hidden today visible, which reverses part of ADR-015, so it needs your decision first. | `isLikelyLiving`, the SQL twin in `repositories/visibility.ts`, and the existing parity test | S–M |
| 2 | **Recently deceased stay private** (`KEEP_ALIVE_YEARS_DEATH`). This only hides more people. | `livingCutoff` and the same predicate. Add one field to `PrivacySettingsDto`. | S |
| 3 | **Computed age at each event** ("aged ~34"), and age at death in the summary | `FactDto.sortStart`, which is the lower bound, and the Life timeline (`life-timeline.ts`). To show a range when the dates are imprecise ("aged 33–35"), the DTO also needs the upper bound. | S |
| 4 | **Suggest a surname when adding a child**: offer the anchor's surname as a one-click suggestion, not a filled-in value. When the anchor is the mother, her stored name may be her birth name. webtrees makes this a configurable "surname tradition". | `RelationshipModal.svelte`, where `anchor.surname` is already passed in | S |
| 5 | **"Unconnected people" quality rule**: people with no path to the self or home person | Connected-components code in `tree-layout/whole-tree.ts`. `quality-checks.ts` already does graph work (`cyclesOf`). Add a row to `QUALITY_RULES`. | S |
| 6 | **"Probably dead, no death recorded" rule with a one-click fix**, the equivalent of webtrees' FixMissingDeaths | `QUALITY_RULES`, `living-state.ts`, and the fact-create mutation | S–M |
| 7 | **Add the missing event and fact types.** Let the editor offer `MARB`, `MARC`, `MARL`, `MARS`, `DIVF` and `EVEN` on partnerships, which the importer already reads. Add `NATI`, `CAST` and `_MILT` to the person set. | `shared/union-events.ts` for partnerships. `shared/fact-types.ts` and `INDIVIDUAL_EVENT_TAGS` in `parser.ts` for people. The export round-trip tests check the result. | S |
| 8 | **Top surnames and given names**, and a basic statistics page with counts by sex and century, average lifespan, and people with no dates | The surname-list query, which already counts people per surname (`list-repository.ts:114`), plus `ViewerScope` | M |
| 9 | **On this day and upcoming anniversaries**: day-precision births, marriages and deaths whose month and day fall within the next N days, visible people only | `date_sort` on day-precision `date_value`, and `ViewerScope` | M |
| 10 | **Print stylesheet** for the person page, the partnership page (which is effectively a family group sheet) and the ancestor outline | Tailwind `print:` variants. Hide the header, toolbar and drawer. | S |
| 11 | **Read-only "GEDCOM" panel** on a person, for editors and above | The GEDCOM serialiser (`gedcom/serializer.ts`, `export-payload.ts`) | S–M |
| 12 | **Show associations** (`ASSO`/`RELA`) read-only on both people's pages | The kept lines already hold the pointer and `RELA`. Parse them at read time, the way the read-only fact lines are shown (ADR-051). | M |
| 13 | **Duplicate sources, notes and repositories** as quality rules, with normalised title equality | The existing merge flows for sources and notes. A repository merge would need adding. | S–M |
| 14 | **Children's births in the Life timeline**: the start of "events of close relatives" | The backlog notes that `PersonSummaryDto` needs a sortable birth. That change unlocks the children's-births half. | M |

Already done, though the comparison might suggest otherwise:

- **Ahnentafel numbering:** `AncestorOutline.svelte`
- **All relationship routes:** `findRelationships` reports every route, not only the shortest
- **A self-person link:** `self-person` API

---

## 3. Full inventory

### Charts

| webtrees module | Epoch | Tag |
|---|---|---|
| Pedigree | `/people/[id]/pedigree` | HAS |
| Descendancy chart | `/people/[id]/descendants` | HAS |
| Fan | `/people/[id]/fan` | HAS |
| Hourglass | `/people/[id]/hourglass`; the tree canvas is also an hourglass | HAS |
| Relationships | `/relationship`, with all routes and a sentence | HAS |
| Interactive tree | The flat canvas | HAS |
| Ancestors list | `AncestorOutline`, with Ahnentafel numbers | HAS |
| Compact tree | none | BACKLOG |
| Family book | none | GAP |
| Lifespans | none | BACKLOG ("timeline and lifespan view") |
| Timeline, comparing several people | none (Life is one person only) | BACKLOG |
| Statistics charts | none | BACKLOG |
| Pedigree map | none | BACKLOG / OUT (lower priority) |
| Pedigree collapse | none | BACKLOG |
| 3D views (Rings, Ball, Ribbons, Orrery) | Epoch only | — |

### Lists

| webtrees | Epoch | Tag |
|---|---|---|
| Individuals | `/people` (search, surname filter, sort) | HAS |
| Families | `/unions` | HAS |
| Surnames | `/surnames` | HAS |
| Branches (`BranchesListModule`) | none | GAP |
| Places, with hierarchy | `/places` (flat), with a map of located places and clustering | PARTIAL / BACKLOG |
| Place locations (`MAP`, by hand, or OSM) | `place_locations`, set from a fact's `MAP`, by hand, or from a Photon pick (ADR-078) | HAS |
| Place pin | Pin on the place page, with "Set location" | HAS |
| Locations (`_LOC`) | none | BACKLOG |
| Sources | `/sources` | HAS |
| Repositories | Inside `/sources`; no page of its own | PARTIAL |
| Notes | `/notes` | HAS |
| Media | `/files` | HAS |
| Submitters | none | N/A (low value) |

### Reports

All 16 report modules are **BACKLOG** ("printable reports"). They are listed in section 1.4.

### Record pages and tabs

| webtrees | Epoch | Tag |
|---|---|---|
| Facts and events tab | Life timeline and grouped facts | HAS |
| Events of close relatives | none | GAP (partly BACKLOG) |
| Computed age at event | none | GAP |
| Historic events | none | GAP (low) |
| Families / relatives tab | Person view: partnerships, parents, siblings, step relatives | HAS |
| Family navigator sidebar | Drawer | HAS |
| Sources, notes and media tabs | Evidence sections | HAS |
| Stories | none | GAP |
| Places tab, with a map | Life map of one person's facts on the person page; partnership events are not shown (ADR-078) | PARTIAL |
| Associates (`ASSO`) | Kept, not shown | GAP |
| Raw GEDCOM view | none | GAP |
| Change history, in metadata | Record history and audit filter (ADR-068) | HAS, and better: undo by id |

### Editing

| webtrees | Epoch | Tag |
|---|---|---|
| Add parent, child or spouse; link existing people | Relationship modal with planning | HAS |
| Add unlinked person, source, note or repository | Yes | HAS |
| Edit facts with full sub-structure | ADR-051 columns | HAS (family-event details are BACKLOG) |
| Edit names; multiple names; reorder | ADR-013 | HAS |
| Reorder facts, citations and notes | Yes | HAS |
| Reorder children and families | Birth order only | GAP |
| Reorder media | none | BACKLOG (galleries and ordering) |
| Merge people, families, sources and notes | Yes | HAS |
| Merge repositories and media; merge facts | none | GAP |
| Copy and paste facts | Group facts | PARTIAL |
| Raw GEDCOM edit | none | GAP (raw *editing* should not be added) |
| Undo | Every change, by id | Epoch only |
| Optimistic concurrency and conflict UI | Yes | Epoch only |
| Pending-change moderation | none | BACKLOG |
| Census assistant | none | GAP (medium value for UK census work) |
| Place autocomplete | `PlaceInput.svelte` suggests the tree's places, and OSM places while typing in the fact and partnership-event editors | HAS |

### Search

Search is covered in section 1.10. In short: name, place and year search is **HAS**, phonetic search is **BACKLOG**, and advanced, multi-record and search-and-replace are **GAP**.

### Privacy and access

| webtrees | Epoch | Tag |
|---|---|---|
| `MAX_ALIVE_AGE` | `maxAliveYears` | HAS |
| `isDead()` using any dated event | Births and deaths only | Deliberate, per ADR-015 (1.1) |
| `isDead()` using relatives' dates | none | Deliberate, per ADR-015 (1.1) |
| Living people shown to visitors only by opt-in (`HIDE_LIVE_PEOPLE`) | A public tree shows living people automatically (ADR-041) | Different by design; worth a warning in the UI |
| Recent birth or death windows | none | GAP |
| Show private people's names | none | GAP |
| Show private relationships | `shouldShowPrivateStructure` | HAS |
| Require sign-in, or public | Per-tree public (ADR-041) | HAS |
| Per-record `RESN` (`none`, `privacy`, `confidential`, `locked`) | Person-level override. `confidential` is not kept. Fact-level `RESN` is kept but has no effect. | PARTIAL (BACKLOG) |
| Default restrictions per fact type | none | GAP |
| Relationship-path privacy | none | GAP |
| Roles | 5 roles, where webtrees has visitor, member, editor, moderator, manager and admin | HAS (no moderator, because there is no moderation) |
| Masquerade, or "view as" | none | GAP. It would be useful for checking what a viewer sees. |

### Collaboration and communication

| webtrees | Epoch | Tag |
|---|---|---|
| Users and roles | Invitations and members | HAS |
| Registration, password reset and email verification | Access | N/A |
| Messages, contact and broadcast | none | GAP |
| News, journal and FAQ blocks | none | GAP |
| Research tasks (`_TODO`) | Tasks, which are Epoch's own and not exported | HAS (exporting them is BACKLOG) |
| Favourites (user and tree) | Per-user favourites and recents | PARTIAL. There are no shared "tree favourites" picked by a manager. |
| Recent changes block and report | Audit log, editors and above (`record:edit`) | PARTIAL |
| Logged-in users | none | N/A (low) |
| Email notification of changes | Invitations only | GAP (pairs with moderation) |

### GEDCOM and interchange

| webtrees | Epoch | Tag |
|---|---|---|
| Import 5.5, 5.5.1 and 7; ANSEL and other character sets | Yes, with a preview | HAS |
| Export 5.5.1 and 7 | Yes, with 7 as the default | HAS |
| Export filtered by access level | Managers only, unfiltered | BACKLOG |
| GEDZIP with media | ADR-074 draft | BACKLOG |
| Clippings cart and branch export | none | BACKLOG |
| Renumber XREFs | none | N/A (Epoch ids are separate from XREFs) |
| Merge and synchronise trees | Import merge mode | PARTIAL |
| Multiple trees | Yes, plus sub-trees | HAS, and better |

### Media

The webtrees media features (thumbnails, watermarks, albums, slideshow, multi-file objects, a media folder manager and level-0 fixes) are covered in section 1.8. All are **BACKLOG**, except watermarks and chart thumbnails, which are **GAP**. Epoch has the Files manager, sniffing and the allowlist, PDFs served inline, and quotas, which webtrees has none of.

### Places and maps

These are covered in section 1.9. Locations, the Places map with clustering, the place pin, the person's life map and OSM suggestions while typing are **HAS**. Hierarchy, `_LOC` records and the pedigree map are **BACKLOG**. Exporting geocoded coordinates is **BACKLOG**, and ADR-078 leaves it undecided. Photon only sends place text, never a person, date or tree id, so the constraint that it must not leak private people holds (ADR-078).

### Dates

| webtrees | Epoch | Tag |
|---|---|---|
| Qualifiers, ranges and periods | ADR-004 and ADR-037 | HAS, and stricter |
| Julian, Hebrew, French Republican and Hijri recorded | Gregorian, Julian, Hebrew and French Republican are recorded (`shared/date-value.ts`). Hijri is not. | PARTIAL |
| Calendar conversion in the display, a per-tree setting | No Julian-day code exists | GAP |
| Calendar page and anniversaries | none | GAP |
| Date display format | none | BACKLOG (settings) |

### Admin, operations and site

| webtrees | Epoch | Tag |
|---|---|---|
| Control panel, site and tree preferences | Administration and Tree settings (ADR-075) | HAS |
| Data fixes framework | Date standardise and place rewrite | PARTIAL |
| Site logs, analytics, robots and webmaster tools | none | N/A |
| Themes and custom CSS/JS | Colour settings | N/A (deferred) |
| Module and plugin system | none | OUT |
| Check for new version and upgrade wizard | Deploy pipeline | N/A |
| Backup | D1 Time Travel; the runbook is BACKLOG | BACKLOG |

---

## 4. Where Epoch is already ahead

The report is about gaps, but these points matter when reading it:

- **Neutral relationship model.** Pedigree is stored per parent (`_PEDI_PARENT`), and step relationships and widowhood are derived. webtrees' family-centric model can show a child adopted by one partner of a couple only awkwardly, through a separate one-parent family.
- **Undo of any change by id**, an append-only change log, and impact previews before destructive edits.
- **Optimistic concurrency** with conflict rows.
- **A richer data-quality report** (20 rules), with dismissals and privacy-leak checks for notes and sources.
- **Sub-trees as lenses**, tree subdomains, a PWA, and the 3D views.
- **Group facts and bulk citations.**
- **Date handling** that never invents precision.

---

## 5. Not verified

- How the partnership page displays imported `MARB`, `MARC`, `MARL`, `MARS` and `DIVF` events.
- Whether webtrees emails moderators about pending changes.
- Whether the phone layouts cover every screen listed here.
- `_MARNM` and `_MILT` handling against current webtrees output. The backlog already flags `_MARNM`.
- How webtrees `main` differs from 2.2.6. `main` is under active development, and its request-handler layout has changed.
