# Epoch architecture

Epoch is a private, single-owner family-tree application with invited collaborators. It is inspired
by the capabilities of [webtrees](https://github.com/fisharebest/webtrees), not its screens or its
implementation. Decisions and their reasons are recorded in [decisions.md](./decisions.md) (ADR-001
onward); open work is in [backlog.md](./backlog.md).

## Product direction

Identity comes from Cloudflare Access; Epoch stores roles and permissions. The first priority is a
correct genealogy graph and an editor that makes complex relationships understandable.

The canonical model is GEDCOM-aware and must round-trip every supported structure without loss.
Unsupported imported structures are retained and written back on export (ADR-003, ADR-023). Under
an event, the structures with a column are modelled (ADR-051); the rest, such as `RESN`, custom tags
and objects, stay verbatim and are listed on the fact as read-only, so nothing is lost silently.

A collaborator can safely create and understand a tree containing:

- a child linked to more than one mother or more than one parental family;
- biological, adoptive, foster, guardian and explicitly unknown parentage;
- step relationships derived from a parent's partnership;
- married and unmarried partners, separation, divorce, annulment, death, widowhood and remarriage;
- incomplete, approximate, ranged and conflicting dates;
- multiple names, events and assertions without overwriting historical evidence;
- GEDCOM import, validation, preview and export with verified supported-record round trips.

### Scope boundaries

Out of scope: DNA matching, automated record hints, native mobile apps, public social networking,
webtrees plugin compatibility and exact parity with every GEDCOM extension. Localization and
theming are deferred. Maps, galleries and certificate/document workflows are lower priority than
the relationship core.

## Stack

Svelte 5 / SvelteKit 3 on Cloudflare Workers, with D1 (Drizzle ORM), R2, Queues and Workflows.

| Resource | Binding | Use |
|---|---|---|
| D1 | `DB` | Normalized genealogy, permissions, citations, change log, jobs |
| R2 | `MEDIA_BUCKET` | Private media files (`media/<treeId>/<mediaId>.<ext>`; legacy `media/<treeId>/<entityId>/<file>` keys are still read), GEDCOM staging, exports (`exports/` prefix, 24-hour expiry) |
| Queue | `GEDCOM_IMPORT_QUEUE` | Large or retryable GEDCOM imports |
| Workflow | `GedcomExportWorkflow` | Exports above 5,000 people (ADR-040) |
| Cloudflare Access | n/a | Authenticated identity; the Worker validates the JWT (issuer, audience, rotating JWKS) |

Queues and Workflows are reserved for large or retryable import, export and media jobs. Durable
Objects are deferred until a demonstrated coordination need exists: D1 transactions and optimistic
concurrency (ADR-005) are enough for the collaborative editor.

Constraints that are easy to break:

1. Do not point `wrangler.jsonc`'s `main` at the custom Worker entry. The adapter overwrites
   whatever it names on every build. Leave `main` at the adapter default and pass
   `workers/entry.ts` positionally in the deploy and preview scripts.
2. Keep the custom entry at `workers/entry.ts`, outside `src/`. It imports a file that only exists
   after `vite build`; under `src/` it would break a fresh-clone typecheck.
3. Use `nodeLinker: node-modules`, never Plug'n'Play.
4. Migrations are backwards compatible (expand-and-contract). `wrangler rollback` restores code,
   never schema.

## Layering

Routes never touch the database directly (ADR-006):

1. **Domain** (`src/lib/server/domain/`): pure models, command interfaces, typed errors
   (`DomainError`, `UnauthorizedError`, `NotFoundError`, `ConcurrencyConflictError`,
   `ValidationError`) and business invariants.
2. **Persistence** (`src/lib/server/repositories/`): D1 implementations with optimistic concurrency
   (`version` columns) and audit metadata.
3. **Service** (`src/lib/server/services/`): coordinate domain commands, enforce tree
   authorization, return DTOs.
4. **Transport and UI** (`src/routes/`, `src/lib/components/`): SvelteKit hooks, API endpoints and
   views. Handlers only parse input, call services and format responses (`treeHandler` and
   `apiHandler`).

`server/` and `shared/` never import `components/` (or `$app`); ESLint enforces it.

Types both sides read live in `src/lib/shared/`; server modules import from `shared/`, never the
reverse. Every edit goes through one mutation runner that plans, previews, applies and records an
append-only change log with undo (ADR-007).

## Data model

The neutral model is the single source of truth; the gendered `families`/`family_children` tables
are gone.

- `person`: identity container, privacy and living-state inputs, record metadata.
- `person_name`: multiple names with types, components and a preferred display name (ADR-013).
- `union`: a partnership episode, never inferred to mean marriage.
- `union_partner`: ordered participants with neutral roles. GEDCOM spouse-role metadata is an
  interchange concern.
- `parent_child`: a direct assertion between two people with a type (`biological`, `adoptive`,
  `foster`, `guardian`, `unknown/other`), optional union context, status, dates, notes and evidence.
- `event`: typed, repeatable facts for a person or union. A fact also carries its address (with the
  file's own layout), `TYPE`, agency, religion, phone, email, fax and web values, coordinates, and the
  place's other sub-lines, each in a nullable column, so the fact editor can show and edit them
  (ADR-051). Any other line under a fact is kept verbatim and shown read-only.
- `media_items`: a stored file. Ownership is the row's `entity_id`, which names a person, a
  partnership or a source, or is null for a detached file (ADR-061). The R2 key names the file, not its owner, so attaching,
  detaching and moving are row updates that never touch the bytes (ADR-050). The Files manager and the source page both attach to a source, and a move may land on a person or a source (ADR-061).
- `subtree`: a named lens on a tree, rooted at one person (ADR-062). It holds `root_person_id` with
  no foreign key, so an undo of a person delete brings the sub-tree back. Membership is not stored:
  the root, its descendants through `parent_child` of any type whose status is not `disputed`, and
  their partners are computed by `inSubtree` in `subtree-membership.ts`. Unique on `(tree_id, slug)`.
- `date_value`: the original GEDCOM text plus parsed lower and upper bounds, precision, calendar
  and qualifier. It never turns `1900` or `ABT 1900` into a fabricated exact day (ADR-004).
- Evidence: sources, repositories, citations, shared notes and research tasks are records
  (ADR-028, ADR-029).
- Places: records derived from each fact's text, with rename and merge; the literal place text on
  an event is never overwritten (ADR-018, ADR-019).

Step relationships are derived from a parent's union; widowhood from partner death and union
history. Death never deletes or rewrites a union. Multiple unions between the same people stay
distinct. Duplicate unions from dirty GEDCOM are merged explicitly, with XREF aliases kept
(ADR-008, ADR-022).

Genealogy identifiers are separate from GEDCOM XREFs (ADR-002). GEDCOM 7 is the default export,
with 5.5.1 as a compatibility profile (ADR-010, ADR-036). Measured query plans are in
[query-plans.md](./query-plans.md); Epoch's own GEDCOM extension tags are in
[gedcom-extensions.md](./gedcom-extensions.md).

## Authorization and privacy

Cloudflare Access supplies the identity; the Worker validates the JWT and upserts the user by stable
`sub` (ADR-001). The Access audience check fails closed, and local development uses an explicit,
non-production identity adapter (`ACCESS_BYPASS_DEV`). One Access application protects `/login`;
the Worker gates everything else (ADR-026).

Tree roles `owner` > `manager` > `editor` > `contributor` > `viewer` gate actions through
`isActionAllowed`. Every endpoint denies by default.

- Living people, and anyone whose state cannot be determined, are private by default, with a
  per-person override (ADR-015). One `ViewerScope` per request carries the rule into every query,
  so totals, paging and counts never leak.
- Sub-trees are managed by `tree:manage_subtrees` (manager and above). A sub-tree whose root the
  viewer may not see is left out of the list and its address is a 404 (ADR-062).
- Members join by invitation (ADR-016, ADR-031). Only the install owner, members and invitees are
  admitted (ADR-034). A tree can be made public to read without signing in (ADR-041).
  Each member may mark one of their trees as the default that `/` opens (ADR-044).
- Media reads check the tree first, then the file's row, then the role, so a caller outside the tree
  learns nothing about a key. Uploads are sniffed and capped, and served by `Content-Type` allowlist
  (ADR-039).
- The Files manager lists files across the trees a caller may see, and each row carries the actions
  the server allowed for it. Editors may upload, rename, attach, detach and move files, and delete
  the files they uploaded; managers and owners may delete any file. The install owner sees metadata
  only for trees they are not in (ADR-050, ADR-041).
- Export is a manager action, and its background job re-checks authorization (ADR-040).
- Settings are the caller's own: anyone signed in may change their colours and motion setting,
  and only the install owner may change the site default (ADR-054).

## Layout and views

Tree pages live under `/trees/<slug>`, and the id still works and redirects there (ADR-045).
With `EPOCH_TREE_HOST_ZONE` set, a tree may also be served at `<slug>.<zone>`, which shows only that
tree. Pages there keep the `/trees/<slug>/…` form, and links that leave the tree go to the app host
(ADR-057).

A sub-tree rides inside the tree's path segment: `/trees/<tree>~<sub>/…`, and the API takes the same
segment. `~` cannot appear in a slug or a UUID. `splitTreeSegment` in `shared/tree-slug.ts` is the
only code that knows the separator, and `treeHandler` resolves the sub-tree and passes it to the
handler beside `treeId` (ADR-062). Keeping the segment positional means the host and redirect checks
in `hooks.server.ts` and `tree-host.ts` need no change (ADR-057).

A sub-tree is a lens, not an access boundary. Under a lens the chart opens on the root, and the
people, surname, union and place lists, search, the person finder and the header counts read only
the members (`inSubtree` is ANDed with `tree_id` and the visibility predicate, so totals and paging
stay in scope). Sources, files, tasks, writes, undo and GEDCOM export stay tree-wide (ADR-062).
The tree page is a focus-centred hourglass: there is always a focus person, and the client fetches a
bounded subgraph rather than the whole tree (ADR-011). Pedigree, descendant, fan, hourglass and
relationship views read the same kin loader (ADR-017, ADR-020). Optional WebGL views (Rings, Ball,
Ribbons, Orrery) share one selection and highlight model (ADR-032, ADR-033, ADR-035); flat is the
default. The flat view shows a minimap once the tree no longer fits the canvas, and draws the whole
tree too, with unconnected families side by side (ADR-046). One person view
renders both the drawer and the person page (ADR-027); the page leads with the person's life as a
timeline, and the drawer groups facts by kind (ADR-053, ADR-058).

Colours and motion are settings, layered like webtrees: the built-in palette, a site default the
install owner sets, and each person's own choice, one group at a time (sex colours, trace palette,
focus line). There is no per-tree layer. The root layout resolves the palette once per page and
every view paints from it; signed-out readers get the site default. Saves are refused below WCAG
contrast floors. A person may also reduce animation, which only adds to the system's own setting
(ADR-054).

## Research basis

- [webtrees](https://github.com/fisharebest/webtrees): editing, charts, multiple trees,
  collaboration and privacy.
- [webtrees privacy documentation](https://webtrees.net/user/privacy/): living-person defaults,
  record and fact restrictions, relationship privacy.
- [FamilySearch GEDCOM 7](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html): record
  structure, family and child links, events, sources, notes, media.
- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).
- [Cloudflare D1](https://developers.cloudflare.com/d1/) and [R2](https://developers.cloudflare.com/r2/).

These define a capability baseline only. Epoch uses original interaction design and implementation.
