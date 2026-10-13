# Backlog

Open fixes first, then proposed additions and changes, grouped by area. Finished work is not listed
here; the reasons behind past decisions are in [decisions.md](./decisions.md), and the shape of the
system is in [architecture.md](./architecture.md). Remove an item when it ships, and add an ADR if
it changes a decision.

Last reviewed: 2026-10-11.

## Part 1: Open fixes

### Security and privacy

- **A merged person leaves a stale media key.** Person merge moves `media_items` rows but not the R2
  object key, which embeds the old entity id. A restricted viewer who can see the surviving person
  gets a false 404 on the moved media, because the read check parses the old id from the key.
  (ADR-039, ADR-022)
- **Tree deletion orphans R2 objects.** `media_items.tree_id` cascades in D1, but the objects are
  never deleted, so storage leaks and the objects are unreachable. Needs a delete-time sweep or a
  lifecycle rule. (ADR-039)
- **A legitimate file sent with 64 KB or more of other form fields is refused** with a 413, because
  the streaming bound adds only 64 KB of multipart slack above the 25 MB file cap. (ADR-039)
- **HEIC and `mif1`-brand AVIF uploads are rejected.** The sniffer accepts ISO-BMFF only for the
  `avif` and `avis` brands. Extend the sniff, or note the limit in the release notes. (ADR-039)
- **`JWKS_MAX_STALE_MS` has no effect on the TTL path.** The 24-hour staleness bound is used only
  for an unknown `kid`; after the 10-minute TTL the certs fetch fails closed with no stale fallback.
  Either use the constant or delete it. (ADR-039)
- **Relationships through a private ancestor are hidden** from a restricted viewer with no sign they
  exist, when private people are omitted. Decide whether that is the intended behaviour. (ADR-015)
- **`confidential` imports as private but exports as `privacy`.** The word is not kept. (ADR-015)
- **Restricted-viewer read cost.** A restricted viewer's surname list reads about 12 rows per person,
  and the partnership list's first page reads 650 rows. The stored-column alternative in ADR-015 is
  the next step if a tree outgrows it.
- **Media privacy only follows the person.** It does not yet follow the other records a media item
  is attached to.

### GEDCOM

- **5.5.1 `CONC` wrapping at 255 bytes** is not implemented. No reader in scope needs it. (ADR-042)
- **Events written before ADR-004's date columns** (`date_raw` with no `date_sort`) never match a
  year-range search. Run `npm run db:backfill:dates -- --remote` on any deployed database that may
  hold them. (ADR-004)
- **`_MARNM` handling is unconfirmed against webtrees.** The reading rests on a recollection: level 1
  on the `INDI`, either `Given /Surname/` or a bare surname. A level-2 `_MARNM` under a `NAME` is
  kept as an extra line, not modelled. (ADR-013)
- **A `NAME` line that disagrees with its `GIVN`/`SURN`, or carries a quoted nickname, comes back in
  canonical form.** Known round-trip loss. (ADR-013)
- **People imported before names were modelled have one name.** Re-import in replace mode brings the
  others back; nothing was migrated. A person created in the editor before then has no name row
  until the first name command. (ADR-013)
- **`events.notes` is still read once on export.** Drop the column in a later contract migration.
  (ADR-029)
- **A source merge or delete touching more than 300 records is refused.** Raise or batch the limit.
  (ADR-028)

### Search, lists and performance

- **Search is linear in the tree's people per query** (about 4 to 8 rows read per person), and offset
  pages are linear in the offset. The surname list reads about 6.5 times the tree's people. Decide on
  counters or a normalised name column before large trees. (ADR-014, [query-plans.md](./query-plans.md))
- **Case folding is ASCII-only.** SQLite `LIKE`, `lower()` and `collate nocase` fold only ASCII, so
  "müller" does not match "Müller". Needs a normalised column, together with the phonetic work.
- **Unsurnamed people sort first** in the people list, because an expression in `ORDER BY` would lose
  the index.
- **Recents are recorded only on the person page and on a focus-box pick,** not when the tree
  refocuses by double-click. Marks for people deleted for good are not pruned (they are just not
  shown). Marks are not in a GEDCOM export.
- **Place list cost** is one pass over the tree's events, like the surname list.
- **Relationship paths are capped** at 20 generations or 3,000 people ("stopped at its limit").
- **A person card truncates the name at 22 characters,** so a long given name loses its end before
  the "née" line.

### Members and invitations

- **No audit entry for membership changes.** (ADR-016)
- **No "leave this tree"** for a member, and no transfer wizard (an owner makes another owner, then
  steps down). (ADR-016)
- **Cloudflare Access is configured separately.** An invited address must also be allowed by the
  Access policy; the app cannot edit it. `npm run setup -- allow <email>` covers a policy the setup
  tool created.

### Tests

- **Flaky e2e specs.** `union-choice.spec.ts` has failed about 1 run in 4 to 8, and
  `undo-and-conflict.spec.ts` ("a concurrent edit opens the conflict dialog") failed once in a full
  run. Find the race and fix it, or quarantine with a tracked reason.

### Code structure

- **Universal loads call the app's own API through `event.fetch`.** On a server render that runs
  `handle` twice (schema check, JWT validation, user upsert). Moving the read-only loads to
  `+page.server.ts` would remove the second pass and about a dozen GET endpoints. Deliberately
  deferred; write an ADR if render latency becomes noticeable.
- **`RelationshipModal.svelte` is about 860 lines.** Reviewed and left whole because its per-intent
  sections share state with the parent. Revisit when a new intent is added.

## Part 2: Proposed additions and changes

### 3D views

- **Settings page for user-configurable colours in the 3D highlights.** Let people adjust the sex
  colours (`RING_TOKENS.male`, `.female`, `.unknownSex` and each view's variants) and the trace
  palette and intersection colour (`HIGHLIGHT_TOKENS`). It could be an app settings page, or a
  "Colours" entry under More > Manage beside Members and Privacy. Settle these first:
  - **Whose choice is it?** More > Manage is per tree and for managers and owners only. A
    viewer-level preference suits people with colour-vision differences better.
  - **Where is it stored?** Per tree is a column on `trees` and needs an expand-and-contract
    migration. Per member sits beside `view_mode`. Per browser is `localStorage`.
  - **How are choices kept legible?** A picker needs a contrast check against the dark stage, and a
    check that trace colours stay distinguishable from each other and from the sex colours. Defaults
    stay colour-blind safe, with a reset.
  - **What else does it affect?** Probably the flat view's card borders, which share the sex shades.
  (ADR-035)
- **Decide whether a 3D view becomes the product default.** Flat stays the default. Promotion needs
  the checklist from ADR-030: stage 6 parity (drag-to-relate included or deliberately excluded),
  the stage 7 performance budgets, the whole e2e suite parameterised over all view modes and green,
  and a trial on the owner's own tree.
- **Decide the fate of Layers and Floors.** They were withdrawn from the controls but still open from
  a link (ADR-032). Promote, keep as hidden, or remove.
- **Printing or exporting a 3D view,** free VR, and drawing cousins in the flat hourglass are out of
  scope today.
- **Phone layout for the 3D views.** Layers tabs on a phone and a readable tilt for Floors were
  planned; confirm what shipped. (ADR-030)

### Charts, reports and views

- **Compact chart.** The remaining item of the fan, hourglass and compact set. (ADR-020)
- **Timeline and lifespan view.**
- **Printable reports:** family group, individual summary, ancestors and descendants. Must be
  accessible and printable.
- **Anniversaries, recent changes and basic statistics.** Today only a counts banner exists.
- **Branch (clippings) export** for a selected person and bounded relatives, with privacy enforced.
  Export is whole-tree only today.
- **Pedigree collapse in charts.** An ancestor reached twice should render once, with a dashed link
  or an "also appears as" badge, never a duplicate card.
- **Home dashboard.** Favourites and recents exist; there is no dashboard.
- **A text alternative to the graph for screen readers,** with arrow-key navigation between
  related nodes (confirm what shipped against the accessibility audit below). The flat view's
  minimap shipped (pointer only, hidden from assistive technology); the 3D views have none.
- **Phone layouts** for the core screens (see PRODUCT.md).

### Search

- **Phonetic search (Soundex/Daitch-Mokotoff),** boolean query syntax, saved searches, and
  source and note search. Needs the normalised name column above.
- **Place-based search by hierarchy,** once places have a hierarchy.

### GEDCOM import and export operations

- **Job UX for import and export:** progress, cancellation, diagnostics, downloadable reports and
  retained job history. Progress is a status poll today. (ADR-040)
- **Extension reporting before import,** so unsupported tags are listed in the preview.
- **Keep the original upload and its checksum** privately for recovery and audit, under a retention
  policy.
- **Conformance corpus and a semantic diff report** between an import and its export.
- **Preserved-source export profile** where valid, beside GEDCOM 7 and 5.5.1.
- **Large-corpus performance targets** measured and documented for import, export and charts.
- **Export UI for exporting tasks;** research tasks are Epoch's own and are not exported. (ADR-029)
- **An export audit is deliberately not planned.** The owner does not want account-level
  accountability tracing, and `change_log` (ADR-007) is scoped to tree content. (ADR-042)

### Collaboration and change control

- **Audit UI.** The change log is the start of it; there is no audit screen. Entries need actor,
  command, affected records and a before/after summary.
- **Contributor suggestions and pending changes,** with manager approval and rejection, and a
  matching capability. Editors keep editing directly.
- **Record history, revert-by-command where safe, and conflict review.**
- **Filtered export for lesser roles,** and a review of logs, caches, R2 keys and metadata and error
  messages for privacy leaks.
- **Authorization matrix coverage for every background job and queue consumer,** not only HTTP
  transports.
- **Notification of research-task assignment,** and a notes screen for repositories. (ADR-029)
- **Decide whether editors should be restricted from private people.** Today editors see everyone,
  because they can change any record anyway. (ADR-015, ADR-016)

### Media and documents

- **Media records.** `OBJE` is retained, not modelled. Model metadata, ownership, dates, notes,
  citations and links to several records or facts.
- **Image dimensions and safe derivatives generated asynchronously,** idempotently.
- **Galleries, record thumbnails, ordering, captions and download permissions.**
- **Scanned documents** (certificates) with transcription and citation workflows.
- **Retention and orphan cleanup for uploads and imports.** Exports are covered by the 24-hour
  expiry and the `exports/` lifecycle rule. (ADR-040)
- **Checksums and a backup policy for R2.**
- **Migrate existing media** by inventorying ownership, checksum, MIME and dangling links before any
  key change.

### Places and maps

- **Hierarchical places** that keep the exact historical text on each event.
- **Aliases, historical names, coordinates, confidence and provenance** on places.
- **Event maps, then ancestor and pedigree maps,** only after place quality is adequate. Optional
  third-party geocoding must never send private-person details outside, and must never overwrite
  historical labels.

### Operations

- **D1 recovery runbook** (Time Travel, tested exports) and a documented, rehearsed restore of D1
  and the required R2 assets.
- **Job dashboards, structured privacy-safe logs, and storage and cost metrics.**
- **Development, staging and production configuration separation,** reproducible provisioning.

### Release hardening

Nothing below has started as a phase. Findings return to the area that owns them.

- **Threat model** for identity, authorization, privacy inference, import parsers, uploads, R2
  delivery, exports and destructive commands.
- **Authorization tests at every route, server action, queue consumer and workflow step;**
  CSRF and origin protections where applicable; secure response headers.
- **Fuzz and mutation-test the GEDCOM parser,** and enforce size, depth and count limits.
- **Accessibility audit to WCAG 2.2 AA:** navigation, editors, dialogs and drawers, graph
  alternatives, contrast, focus and reduced motion.
- **Performance tests** on small, medium and large trees, profiling D1 reads and writes, pagination,
  layout and job memory and time; no whole-tree API dependency (the bounded whole-tree 3D read in
  ADR-035 is the one capped exception).
- **Resilience tests:** queue retries, duplicate delivery, workflow failure, migration interruption
  and concurrent edits.
- **Production observability:** error tracking and job alerts.
- **Documentation:** deployment, Access setup, role model, backup and restore, migration, import
  diagnostics, privacy behaviour and a collaborator guide. Replace the README's hand-made Access
  steps with `npm run setup`.
- **Release migration rehearsal and rollback procedure,** with smoke tests on a fresh deployment and
  an upgraded snapshot.
- **Dependency and licence review,** and removal of dead paths.

### Setup tool (`npm run setup`)

The tool is built in `tools/setup/` but has not been run against a real account.

- **Run `npm run setup -- spike` against a real Cloudflare account.** It runs the read-only checks,
  sends writes with `--dry-run`, and saves each raw response under `.epoch/spike/`. Use the results
  to replace the synthesized test fixtures, settle the open claims below, and record the outcome in
  an ADR. The open claims:
  - device login output format and the granted-scope readback after unticking an optional scope;
  - whether the Access endpoints accept the `cf` OAuth token, and whether the create response
    carries `aud`;
  - wrangler profiles and `wrangler whoami` agreeing with `cf`;
  - whether `vars` reach `$app/env/private`, and whether a var named `CF_ACCESS_AUD` can replace an
    existing secret of that name;
  - whether a `send_email` binding naming an unverified sender fails the deploy;
  - whether `wrangler d1 migrations apply` and `d1 execute` accept the binding name `DB`;
  - `CLOUDFLARE_CF_AUTH` with `wrangler deploy` (expected to be ignored);
  - tag scopes: a profile with the base scopes can list tags, and a write with a stale ETag answers
    412 (`tag-write-etag-412` creates and removes a throwaway queue).
- **`--deploy-auth=ephemeral` is refused for now.** Reconcile needs a wrangler token to inspect an
  existing Worker, which a minted deploy token cannot provide. Make it reachable or remove the code.
- **Re-check on each wrangler upgrade** whether `wrangler deploy` honours `CLOUDFLARE_CF_AUTH`, which
  would allow one consent instead of two. Also check that a D1 binding with no `database_id` still
  resolves by `database_name` (resource provisioning, behind the hidden `--x-provision` flag that
  defaults to on), which ADR-043 relies on.
- **Scrub the owner's values from git history before the repository goes public.** Until ADR-043,
  `wrangler.deploy.jsonc` was tracked, with the D1 id, team domain, install id and sender address.
- **Open owner decisions:** the default deploy auth (second OAuth consent, or a single-consent
  ephemeral token); whether to keep `cf` pinned as a devDependency; whether setup should onboard the
  Email Sending domain or only report its status (report only is proposed, since verification
  touches DNS).
- **Post-deploy tag check.** Mark-configured restores tags a deploy dropped but does not report that
  they were dropped; report it.
- **Delete `scripts/setup-cloudflare.sh`** if it is still present, and offer to in the hand-off.
