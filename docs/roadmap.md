# Epoch genealogy roadmap

## Product direction

Epoch will be a private, single-owner family-tree application with invited collaborators. Cloudflare Access supplies identity; Epoch stores roles and permissions. The first release prioritizes a correct genealogy graph and an editing experience that makes complex relationships understandable. It is inspired by webtrees capabilities, not its screens or implementation.

The canonical model remains GEDCOM-aware and must round-trip every supported structure without loss. Unsupported imported GEDCOM structures are retained for later export rather than silently discarded.

## Success criteria for the core release

A collaborator can safely create and understand a tree containing:

- a child linked to more than one mother or more than one parental family;
- biological, adoptive, foster, guardian and explicitly unknown parentage;
- step relationships derived from a parent's partnership;
- married and unmarried partners, separation, divorce, annulment, death, widowhood and remarriage;
- incomplete, approximate, ranged and conflicting dates;
- multiple names, events and assertions without overwriting historical evidence;
- GEDCOM import, validation, preview and export with verified supported-record round trips.

## Architectural direction

Refactor the current prototype around a domain/service boundary rather than extending route handlers and the single large page. The primary D1 model should use neutral `union`/`partner` concepts and direct parent-child assertions, not gendered `husband_id`/`wife_id` columns. Family membership, event history and relationship type must remain distinct.

Use:

- **D1** for normalized genealogy, permissions, citations, audit history and jobs;
- **R2** for private originals, derivatives, GEDCOM staging and exports;
- **Cloudflare Access** for authenticated identity, with JWT validation at the Worker;
- **Queues/Workflows** only for large or retryable import, export and media jobs;
- **SvelteKit server actions/API services** with shared validation and authorization;
- a preserved GEDCOM syntax layer plus normalized projections for application queries.

Do not introduce Durable Objects until a demonstrated coordination need exists. D1 transactions and optimistic concurrency are sufficient for the initial collaborative editor.

## Phase status

| Phase | Outcome | Status | Depends on | Parallel work |
|---|---|---|---|---|
| [0](./phase-0-foundations.md) | Testable architecture, Access identity and authorization boundary | Complete | — | Schema spike, UX prototypes and GEDCOM fixtures can run together |
| [1](./phase-1-genealogy-core.md) | Correct relationship/event model and lossless supported GEDCOM | Complete | Phase 0 decisions | Schema/domain and parser fixture work can partly run together |
| [2](./phase-2-relationship-editor.md) | Safe, comprehensible relationship-first editing UX | Complete | Phase 1 contracts | Editor components and graph visualization can run together |
| [3](./phase-3-records-navigation.md) | Useful person/family records, search and navigation | Complete | Phases 1–2 | Record views, search and date/place UI are parallelizable |
| [4](./phase-4-collaboration-privacy.md) | Roles, living-person privacy, audit and change review | In progress | Phases 0–3 | Privacy evaluation and audit UI can run together |
| [5](./phase-5-evidence-quality.md) | Sources, citations, notes and data-quality workflows | Complete | Phases 1, 3–4 | Evidence UI and quality rules can run together |
| [6](./phase-6-charts-reports-interchange.md) | Broader charts, reports and production-grade interchange | In progress | Phases 1–5 | Each chart/report is mostly independent after shared queries |
| [7](./phase-7-media-places-operations.md) | Media, documents, maps and operational maturity | Planned | Phases 4–5 | Media and place/map streams are independent |
| [8](./phase-8-release-hardening.md) | Recoverable, accessible and supportable release | Planned | All release-scope phases | Security, accessibility and load testing can overlap |

Update only this table when phase status changes (`Planned`, `In progress`, `Blocked`, `Complete`). Each phase document owns its detailed exit criteria and a status section against them. Work is delivered in numbered slices (S0, S1a … S17); the slice table and per-slice status notes are in [improvement-plan.md](./improvement-plan.md#delivery-slices).

Where each open phase stands (2026-10-04):

- **Phase 4:** privacy (S8) and members (S9) are done; audit, contributor suggestions and record history wait.
- **Phase 6:** pedigree, descendant and relationship charts (S10) and fan and hourglass (S12) are done; the 3D layers and floors views (S16, ADR-030) are built, merged and deployed, but withdrawn from the controls while the owner decides on them (ADR-032); the rings overview (S17, ADR-032) is offered beside flat, which stays the product default. Production-grade import/export jobs, reports, timelines and branch export wait.
- **Phase 7:** not started as a phase, though S8 put media reads behind the privacy check and S11 added place records with rename and merge.

## Delivery slices

- **Relationship MVP:** Phases 0–2. This is the first usable milestone and deliberately excludes maps, reports and rich media.
- **Private collaborative beta:** Phases 3–4.
- **Evidence-capable genealogy release:** Phase 5 plus selected Phase 6 import/export and charts.
- **Feature expansion:** Remaining Phase 6, then Phase 7.
- **Release gate:** Phase 8 applies continuously, with its final exit gate after chosen scope is complete.

## Parallel execution rules

- Parallelize only behind stable contracts: migration/schema, domain commands, query DTOs and authorization policy.
- One workstream owns migrations at a time. Other streams use fixtures or an agreed schema branch.
- GEDCOM conformance tests are the merge gate for any core-model change.
- UX work may use contract fixtures while domain work proceeds, but cannot define relationship semantics independently.
- Media/maps must not delay the relationship MVP.

## Current prototype assessment

Written before Phase 0 began. Every item in the replace list below has since been replaced.

Useful starting assets include Svelte 5/SvelteKit, D1/Drizzle, R2 bindings, queue/workflow scaffolding, basic person/family endpoints, GEDCOM tests and a graphical tree. The following should be replaced rather than entrenched:

- gendered two-column families and family-wide child pedigree;
- duplicate-family merging based only on spouse IDs;
- date normalization that turns partial/approximate dates into false exact dates;
- runtime schema creation in request paths;
- one-page modal-heavy UI and route handlers containing domain logic;
- whole-tree payloads and tree layout normalization that can erase meaningful duplicate unions;
- unauthenticated APIs and public-style media reads.

## Scope boundaries

Early scope excludes DNA matching, automated record hints, native mobile apps, public social networking, plugin compatibility with webtrees and exact parity with every GEDCOM extension. Localization and theming are deferred until core screens stabilize. Maps, galleries and certificate/document workflows are explicitly lower priority.

## Research basis

- [webtrees project](https://github.com/fisharebest/webtrees): editing of individuals, families, sources and media; pedigree/fan/descendant/relationship charts; multiple trees; collaboration and privacy.
- [webtrees privacy documentation](https://webtrees.net/user/privacy/): living-person defaults, record/fact restrictions, private-family propagation and relationship privacy.
- [FamilySearch GEDCOM 7 specification](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html): record structure, family/child links, events, sources, notes and media semantics.
- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/): validate the Access assertion at the Worker using issuer, audience and rotating JWKS.
- [Cloudflare D1](https://developers.cloudflare.com/d1/) and [R2](https://developers.cloudflare.com/r2/): relational storage, recovery and private object storage capabilities.

These references define a capability baseline only. Epoch should use original interaction design and implementation.
