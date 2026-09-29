# Epoch Architecture Decisions (Phase 0)

## ADR-001: Identity, Cloudflare Access and User Management
- **Context:** Epoch is a private, single-owner family-tree application with invited collaborators behind Cloudflare Access.
- **Decision:**
  - Authenticated identity is verified via Cloudflare Access JWT assertions (`Cf-Access-Jwt-Assertion` request header or `CF_Authorization` cookie).
  - Validation checks JWT issuer (Cloudflare team domain), audience tag (`AUD`), and rotating JWKS from `https://<team-domain>.cloudflareaccess.com/cdn-cgi/access/certs`.
  - For local development and automated testing environments, a configurable mock identity or local public key verifier is supported when explicit development flags are provided, while denying anonymous access by default.
  - The local `users` record is keyed and upserted by the stable Access subject claim (`sub`), treating `email` as mutable profile metadata.
  - Tree-level access is controlled via `tree_memberships` supporting roles: `owner`, `manager`, `editor`, `contributor`, `viewer`. Every server endpoint and action denies access by default.

## ADR-002: Genealogy Identifiers vs GEDCOM XREFs
- **Context:** GEDCOM files use XREF tokens (such as `@I1@`, `@F1@`) that are tree- or file-scoped, frequently collide between different imports, and can be unstable across re-exports.
- **Decision:**
  - All Epoch internal entities (persons/individuals, unions/families, events, citations, media) use internally generated UUIDs as primary keys.
  - GEDCOM XREFs are preserved as tree-scoped import/export aliases (`xref_id`) rather than internal primary keys.
  - This allows cross-tree references, multi-source merging, and prevents XREF collision corruption while ensuring lossless round-trip export by re-attaching or re-mapping XREFs.

## ADR-003: Lossless GEDCOM Preservation
- **Context:** Epoch aims for full round-trip fidelity with supported structures and lossless retention of unsupported GEDCOM structures.
- **Decision:**
  - Supported structures map to normalized relational tables (persons, partnerships, parent-child links, events).
  - Unsupported tags, custom vendor extensions (`_ATTR`, etc.), and unhandled sub-trees are preserved in an unparsed/syntax-preservation payload (JSON or raw records linked to entity IDs) so they are preserved without silent loss upon export.

## ADR-004: Historical Date Representation
- **Context:** Genealogy dates are frequently incomplete (e.g. `1910`, `MAY 1920`), approximate (`ABT 1845`, `EST 1850`, `CAL 1900`), ranged (`BET 1860 AND 1865`, `FROM 1901 TO 1905`), or conflicting. Converting them into arbitrary exact dates (like `1910-01-01`) destroys historical accuracy.
- **Decision:**
  - Dates are stored with both `date_raw` (verbatim string from historical record or user entry) and structured date metadata:
    - Date type/modifier: `EXACT`, `ABOUT`, `ESTIMATED`, `CALCULATED`, `BEFORE`, `AFTER`, `BETWEEN`, `FROM_TO`.
    - Earliest sort key (`date_sort_start`) and latest sort key (`date_sort_end`) in `YYYY-MM-DD` format for sorting, indexing, and chronological filtering.
  - Incomplete dates (year only or month/year) preserve their granularity rather than claiming precision that does not exist.

## ADR-005: Concurrency and Versioning
- **Context:** Multiple invited collaborators may view or edit tree records simultaneously.
- **Decision:**
  - Optimistic concurrency control is implemented using a numeric `version` column and `updated_at` on mutable root entities (`trees`, `individuals`, `families`/`unions`, `events`).
  - Domain mutation commands verify that the client's provided version matches the stored version before writing. A mismatch returns a typed `ConcurrencyConflictError` (HTTP 409).
  - D1 atomic transactions (or batch operations) are used for multi-row mutation commands. Durable Objects are deferred until real-time multi-cursor collaboration demonstrates a clear need.

## ADR-006: Layered Architecture and Clean Boundaries
- **Context:** The prototype embedded database queries and runtime schema initialization directly inside SvelteKit route handlers and single-page components.
- **Decision:**
  - The application is decoupled into distinct architectural layers:
    1. **Domain Layer:** Pure domain models, command interfaces, typed error definitions (`DomainError`, `NotFoundError`, `UnauthorizedError`, `ConcurrencyConflictError`, `ValidationError`), and business invariant checks.
    2. **Persistence/Repository Layer:** D1 implementations implementing repository interfaces with versioning and audit trails.
    3. **Query/Service Layer:** Read and write services that coordinate domain commands, enforce tree authorization, and return DTOs.
    4. **Transport/UI Layer:** SvelteKit server hooks, actions, API endpoints, and component views. Route handlers only parse inputs, invoke application services, and format responses. Direct database operations inside routes are prohibited.

## ADR-007: Persisted, append-only change log and undo (Phase 2, S2)
- **Context:** Undo used to be an in-memory array on `RelationshipService`, and a new service is constructed per request, so it could never work. Destructive removals, person edits and union edits wrote nothing at all. Phase 4 needs an audit log and per-record history, and should build on the same rows rather than replace them.
- **Decision:**
  - Two tables, added by an expand-only migration: `change_log` (one row per user-visible change) and `change_log_records` (the records each change wrote). Neither is read by existing code, so the deploy order is migrate, then code. `schema-init.ts` is not extended; it is S4 debt.
  - **Append-only.** Rows are inserted and never updated. An undo is a new row whose `reverts_change_id` names the change it reverses; "already undone" is derived from that, and a partial unique index on `reverts_change_id` means two concurrent undos cannot both succeed.
  - **Ordering by `seq`** (autoincrement), not by timestamp, which collides within a millisecond. `id` is a UUID generated before the write so the batch can reference it without reading `seq` back.
  - **Row operations are the unit.** Every mutation is first planned in memory as a list of row operations (`table`, `id`, `before` image or null, `after` image or null). The inverse is the same list reversed with before and after swapped, so any change is undoable, including deleting a person or a union with its links, partners and events. The inverse is stored in `inverse_json`; the field-level before/after summary shown to people is in `changes_json`. This deliberately replaces per-command `inverseOf`, which lost context (re-creating a removed parent link dropped its union) and had no answer for `destroy_union` or deleting a person.
  - **Atomic.** The row operations, version guards and log rows are applied in one `db.batch`, as ADR-005 requires, so a change is either fully applied and logged or not applied. A guard is an `INSERT` into `change_log` of NULL for a NOT NULL column that runs only when the expected row version is absent; the constraint error aborts the whole batch and is reported as `ConcurrencyConflictError`.
  - **Undo rules.** Undo applies to the requesting user's most recent undoable change in that tree that has not been undone. It is refused, with a message naming what changed, when a later change (by anyone, including an earlier undo) wrote any of the same records, and when the records no longer look the way the change left them (for example an import touched them). Undo rows are not themselves undoable; there is no redo in Phase 2.
  - **Affected records** are the rows a change wrote (people, names, unions, partners, parent-child links, events, media links). A person edit does not lock the person's relationships against undo, and a relationship change does not lock the people.
  - **Tree deletion cascades** to its log (`change_log.tree_id` has `ON DELETE CASCADE`). Before/after images contain personal data, and deleting a tree must erase it. The deletion itself is therefore not in the log; it is only in the structured request log. Phase 4 may add an account-level audit stream if that is needed.
  - **Not covered:** GEDCOM import and merge write no log rows in Phase 2; they replace or extend whole trees and are not undoable. `actor_id` has no foreign key so the log survives a removed user.
- **Consequences:** Phase 4's audit view reads `change_log` and `change_log_records` directly and adds visibility rules; moderation (pending changes) can store proposed row operations in the same shape. Payloads grow with the size of a change, which is small except for deleting a very large union or person.
