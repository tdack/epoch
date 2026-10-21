# Epoch Architecture Decisions

Each decision lives in `docs/adr/ADR-NNN.md`; a new ADR takes the next number and gets a row here.

| ADR | Title | Link | Status |
| --- | --- | --- | --- |
| 1 | Identity, Cloudflare Access and User Management | [ADR-001.md](adr/ADR-001.md) | Implemented |
| 2 | Genealogy Identifiers vs GEDCOM XREFs | [ADR-002.md](adr/ADR-002.md) | Implemented |
| 3 | Lossless GEDCOM Preservation | [ADR-003.md](adr/ADR-003.md) | Implemented |
| 4 | Historical Date Representation | [ADR-004.md](adr/ADR-004.md) | Implemented |
| 5 | Concurrency and Versioning | [ADR-005.md](adr/ADR-005.md) | Implemented |
| 6 | Layered Architecture and Clean Boundaries | [ADR-006.md](adr/ADR-006.md) | Implemented |
| 7 | Persisted, append-only change log and undo | [ADR-007.md](adr/ADR-007.md) | Implemented |
| 8 | Union merge and XREF aliases | [ADR-008.md](adr/ADR-008.md) | Implemented |
| 9 | PEDI is per child link, stored per parent | [ADR-009.md](adr/ADR-009.md) | Implemented |
| 10 | Sex X and the 5.5.1 fallback | [ADR-010.md](adr/ADR-010.md) | Implemented |
| 11 | The bounded graph and the record pages | [ADR-011.md](adr/ADR-011.md) | Implemented |
| 12 | Facts have their own columns and are addressed by id | [ADR-012.md](adr/ADR-012.md) | Implemented |
| 13 | Person names | [ADR-013.md](adr/ADR-013.md) | Implemented |
| 14 | Recents and favourites are per-user D1 rows | [ADR-014.md](adr/ADR-014.md) | Implemented |
| 15 | Who is private, and where it is decided | [ADR-015.md](adr/ADR-015.md) | Implemented |
| 16 | Members and invitations | [ADR-016.md](adr/ADR-016.md) | Implemented |
| 17 | Kinship and the charts | [ADR-017.md](adr/ADR-017.md) | Implemented |
| 18 | A place is the text on a fact; no stored reference yet | [ADR-018.md](adr/ADR-018.md) | Implemented |
| 19 | Place records derived from the fact's text; rename and merge | [ADR-019.md](adr/ADR-019.md) | Implemented |
| 20 | Fan and hourglass charts, and a text list of ancestors | [ADR-020.md](adr/ADR-020.md) | Implemented |
| 21 | Data-quality report with stored dismissals | [ADR-021.md](adr/ADR-021.md) | Implemented |
| 22 | Merging two records of one person | [ADR-022.md](adr/ADR-022.md) | Implemented |
| 23 | A file's evidence is kept whole before it is modelled | [ADR-023.md](adr/ADR-023.md) | Implemented |
| 24 | A public welcome page, and the paths Access must let through | [ADR-024.md](adr/ADR-024.md) | Implemented |
| 25 | Lint and format toolchain | [ADR-025.md](adr/ADR-025.md) | Implemented |
| 26 | One Access application on `/login`; the Worker gates everything else | [ADR-026.md](adr/ADR-026.md) | Implemented |
| 27 | One person view, in two frames; the open drawer lives in the query string | [ADR-027.md](adr/ADR-027.md) | Implemented |
| 28 | Sources, repositories and citations are records | [ADR-028.md](adr/ADR-028.md) | Implemented |
| 29 | Notes are records; research tasks are Epoch's own; privacy-leak checks | [ADR-029.md](adr/ADR-029.md) | Implemented |
| 30 | 3D tree views are CSS 3D over HTML planes, chosen by `mode` | [ADR-030.md](adr/ADR-030.md) | Superseded by ADR-047 |
| 31 | Invitations are emailed; sending never undoes them | [ADR-031.md](adr/ADR-031.md) | Implemented |
| 32 | The rings overview is WebGL with free orbiting; Layers and Floors leave the controls | [ADR-032.md](adr/ADR-032.md) | Implemented |
| 33 | Ball, Ribbons and Orrery join Rings as selectable WebGL views | [ADR-033.md](adr/ADR-033.md) | Implemented |
| 34 | Only the install owner, members and invitees are admitted | [ADR-034.md](adr/ADR-034.md) | Implemented |
| 35 | The 3D views gain a whole tree, partnership and line selection, and a trace mode | [ADR-035.md](adr/ADR-035.md) | Implemented |
| 36 | GEDCOM 7.0 is the default export; import detects version and character set; GEDZip | [ADR-036.md](adr/ADR-036.md) | Implemented |
| 37 | Loosely typed dates are read, offered in standard form, and never block an edit | [ADR-037.md](adr/ADR-037.md) | Implemented |
| 38 | The deploy config is tracked | [ADR-038.md](adr/ADR-038.md) | Superseded by ADR-043 |
| 39 | Uploaded media is sniffed from its bytes and served by allowlist; non-raster is a download | [ADR-039.md](adr/ADR-039.md) | Implemented |
| 40 | A large export runs in a workflow; expiry is enforced at read time and a lifecycle rule is the GC | [ADR-040.md](adr/ADR-040.md) | Implemented |
| 41 | One tree can be public, read without signing in | [ADR-041.md](adr/ADR-041.md) | Implemented |
| 42 | GEDCOM `@`-escaping is done at build time; the tree name round-trips | [ADR-042.md](adr/ADR-042.md) | Implemented |
| 43 | The deploy config is git-ignored; Workers Builds gets its values as one build variable | [ADR-043.md](adr/ADR-043.md) | Implemented |
| 44 | Each member picks a default tree; the Trees page moves under the tree | [ADR-044.md](adr/ADR-044.md) | Implemented |
| 45 | Trees have a readable address; the id still works and redirects to it | [ADR-045.md](adr/ADR-045.md) | Implemented |
| 46 | The flat view gains the whole tree | [ADR-046.md](adr/ADR-046.md) | Implemented |
| 47 | Floors and Layers are removed | [ADR-047.md](adr/ADR-047.md) | Implemented |
| 48 | Content-Security-Policy ships report-only first, with transport and framing headers | [ADR-048.md](adr/ADR-048.md) | Implemented |
| 49 | Name search moves to an FTS5 table kept current by triggers | [ADR-049.md](adr/ADR-049.md) | Implemented |
| 50 | A file's owner lives in D1, not its key; the Files manager | [ADR-050.md](adr/ADR-050.md) | Implemented |
| 51 | Fact details are columns, and kept lines show read-only | [ADR-051.md](adr/ADR-051.md) | Implemented |
| 52 | Security audit 2026-10-13, F11 to F18: what was fixed, what was not, and the rules that came out of it | [ADR-052.md](adr/ADR-052.md) | Implemented |
| 53 | One section order for the person page and drawer, evidence against claims, facts grouped by kind | [ADR-053.md](adr/ADR-053.md) | Implemented |
| 54 | Colours and motion are settings, layered like webtrees: user, then site, then built-in | [ADR-054.md](adr/ADR-054.md) | Implemented |
| 55 | A write plans over a scoped snapshot; equality with the whole tree is the proof | [ADR-055.md](adr/ADR-055.md) | Implemented |
| 56 | Drag-to-relate is removed from the flat view | [ADR-056.md](adr/ADR-056.md) | Implemented |
| 57 | A tree can be served on its own subdomain | [ADR-057.md](adr/ADR-057.md) | Implemented |
| 58 | The person page leads with the person's life | [ADR-058.md](adr/ADR-058.md) | Implemented |
| 59 | The person page opens on the newest of each attribute | [ADR-059.md](adr/ADR-059.md) | Implemented |
| 60 | Every `/api` error is `{ error, code, details? }` | [ADR-060.md](adr/ADR-060.md) | Implemented |
| 61 | A source can own files, visible exactly when the source is | [ADR-061.md](adr/ADR-061.md) | Implemented |
| 62 | A tree can have sub-trees rooted at a person | [ADR-062.md](adr/ADR-062.md) | Implemented |
| 63 | Tree subdomains can be turned off, and D1 keeps what setup made on the zone | [ADR-063.md](adr/ADR-063.md) | Implemented |
| 64 | Under Vitest the adapter's platform proxy keeps no state on disk, and one full suite runs at a time | [ADR-064.md](adr/ADR-064.md) | Implemented |
| 65 | Setup provisions Cloudflare itself; Terraform is not adopted | [ADR-065.md](adr/ADR-065.md) | Implemented |
| 66 | Abuse limits are Workers Rate Limiting bindings, not dashboard rules | [ADR-066.md](adr/ADR-066.md) | Implemented |
| 67 | Read-only page data loads on the server, through the services | [ADR-067.md](adr/ADR-067.md) | Implemented |
| 68 | The audit log, and undo of any change by id | [ADR-068.md](adr/ADR-068.md) | Implemented |
| 69 | A sub-tree is shown to the public only when a manager makes it public | [ADR-069.md](adr/ADR-069.md) | Implemented |
| 70 | A profile page, an avatar copied into R2, and what leaving Epoch will mean | [ADR-070.md](adr/ADR-070.md) | Implemented |
| 71 | Group facts are copies and bulk sources are per-person citations | [ADR-071.md](adr/ADR-071.md) | Implemented |
| 72 | Leave Epoch, as built | [ADR-072.md](adr/ADR-072.md) | Implemented |
| 73 | PDFs are served inline in a new tab | [ADR-073.md](adr/ADR-073.md) | Implemented |
| 74 | GEDZIP import and export with media, staged in R2 and processed by Workflow | [ADR-074.md](adr/ADR-074.md) | Draft |
| 75 | One page per scope: Account, Tree settings and Administration | [ADR-075.md](adr/ADR-075.md) | Accepted |
