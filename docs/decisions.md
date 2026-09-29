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

## ADR-008: Union merge and XREF aliases (Phase 2, S3)
- **Context:** A dirty GEDCOM carries several `FAM` records for one family. Every union's XREF is its id (`<treeId>:@F1@`), so deleting a merged union would delete the only record of that XREF, and a NOTE or CHAN preserved under it would no longer belong to anything on export.
- **Decision:**
  - **Aliases are a nullable JSON column, `unions.xref_aliases`, on the surviving union**, added by an expand-only migration (`ADD COLUMN`; nothing reads it until this deploy). The alternative, an `union_aliases` table, would have to join `RECORD_TABLES`, the loader, the labeller and the impact grouping to be undoable. A column rides the survivor's ordinary update op, so undo restores it with no new machinery.
  - **Aliases carry transitively.** Merging a union that already has aliases moves those aliases to the survivor as well as adding the merged union's own XREF. A union whose id is not an imported XREF (created in the editor) adds no alias, because no other record ever named it.
  - **Export emits the survivor once**, under its own XREF, and re-attaches structures preserved under any alias to it. Each alias is written on the survivor as `1 REFN <xref>` with `2 TYPE epoch-merged-family`; the importer reads those back into `xref_aliases`, so a re-import recovers them. Alias `FAM` records are deliberately not re-emitted: the merge dissolved which child belonged to which copy, so a regenerated copy would be a guess, and two `FAM` records for one family is the exact defect being fixed.
  - **`merge_unions` is one command through `MutationRunner`.** It deletes the merged unions and their partner rows, moves child links and events onto the survivor, drops events identical to one the survivor already has, and updates the survivor's aliases, status and version, so it is logged and undone like any other change.
  - **Conflicts are never resolved silently.** Two unions conflict when they carry the same event type with different date, place or description, or when their statuses differ. An event type or status present on only one side is not a conflict; merging fills the gap. The command refuses with a typed error listing every conflict unless the request names, for each conflicting event type and for the status, which union's fact to keep.
  - **Import-time merge is stricter than the command.** Only a group with two or more partners, the same partner set, identical facts (both empty counts) and no child recorded with two different pedigrees is merged automatically. A one-partner `FAM` is never merged automatically: two of them may be different, unrecorded, other parents. Everything else is listed as a possible duplicate for review.
- **Chronological labels ("1st partnership") need two recorded partners.** Two one-partner records are not known to be the same pair, so they get no chronology; previews number them ("1 of 2") and the merge dialog offers them, because the command allows it and the person decides.
- **Consequences:** Re-importing the same dirty file in merge mode would bring back the merged-away `FAM` records, because the importer matches on XREF and does not look at `xref_aliases`. That is a known gap.

## ADR-009: PEDI is per child link, stored per parent (Phase 2, S3)
- **Context:** `PEDI` describes a child's link to a family, and the standard place for it is `INDI.FAMC.PEDI`. Epoch read and wrote it under `FAM.CHIL`, which no other program understands, and its parser dropped everything under `FAMC`.
- **Decision:**
  - **Read** `PEDI` from the child's `FAMC`. The old `CHIL.PEDI` is still read for files Epoch exported earlier, and `FAMC` wins when both are present. Values are case-insensitive (`adopted` in 5.5.1, `ADOPTED` in 7.0).
  - **Store** it as one `parent_child` row per parent, with the same type on each, because a `FAMC` names the family and not a parent.
  - **Write** `PEDI` under `FAMC`, lowercase in 5.5.1 and uppercase in 7.0, and stop writing it under `CHIL`. `birth` is the default and is omitted.
  - **`sealing` and `other`** have no neutral type. They are stored as `unknown` with the word in the nullable `parent_child.gedcom_pedi`, and written back from it. 5.5.1 has no `OTHER`, so `other` is dropped from a 5.5.1 export and kept in 7.0.
  - **Different types for the two parents** are legal in the model but cannot be said in one `PEDI`. The family's `PEDI` is the first parent's type, and each parent who differs is written as `2 _PEDI_PARENT @I2@` with `3 PEDI adopted`. Epoch reads it back; other programs ignore a user-defined tag.
  - **Known losses.** A `guardian` link exports as `foster`, and an `unknown` link without a `gedcom_pedi` exports as birth (the default), so both come back as different types. Other structures under `FAMC` (`STAT`, `NOTE`) are still dropped by the parser.

## ADR-010: Sex X and the 5.5.1 fallback (Phase 1, S4)
- **Context:** The graph domain and the GEDCOM parser accepted `X`, but `individuals.sex` was typed `M | F | U`, the importer mapped `X` to `U`, and the person form, validation and card had no `X`. A GEDCOM 7 file with `SEX X` lost that on import.
- **Decision:**
  - **One list.** `src/lib/shared/sex.ts` holds `SEX_VALUES` (`M`, `F`, `X`, `U`), its labels and a guard. The Drizzle column, the zod schema, the person form and the drawer all read it, so they cannot drift.
  - **No migration.** The column is `text DEFAULT 'U'` with no `CHECK`; the enum was TypeScript only, so widening it changes no stored data and no deployed schema.
  - **Card.** `X` has its own symbol (⚧) and shares the neutral fill with unknown (○), as the tree design specifies. The legend lists Other and Unknown separately.
  - **Export in 7.0:** `1 SEX X`, which 7.0 defines.
  - **Export in 5.5.1:** `SEX` allows no `X`, so the export writes `1 SEX U` followed by `1 _EPOCH_SEX X`. `U` is a value every 5.5.1 reader accepts and is true (the file cannot say more); the user-defined line, which readers ignore, lets Epoch restore `X` on re-import. This is the same device as `_PEDI_PARENT` (ADR-009). The alternative, writing only `U`, would silently turn `X` into "unknown" on a round trip.
- **Consequences:** Another program that reads the 5.5.1 file sees `U`; only Epoch reads `_EPOCH_SEX`. Someone who edits the file elsewhere and changes `SEX` away from `U` wins over `_EPOCH_SEX`, since the tag only restores `X` when `SEX` is `U`.

## ADR-004 addendum: how the date columns are stored (Phase 1, S4)
- `events` gains nullable `date_sort_end`, `date_qualifier`, `date_precision` and `date_calendar` (migration 0007, expand-only). `date_sort` keeps meaning the inclusive lower bound, so nothing that read it changes. `date_raw` stays verbatim and is never rewritten.
- **One derivation.** `dateColumnsFor` (over `parseDateValue`) fills the columns on create, edit and import. `1900` is stored as year precision with bounds `1900-01-01`..`1900-12-31`, and `ABT 1900` keeps `ABOUT`; neither becomes a day. Text that is not a date is stored as `UNKNOWN` or `PHRASE` with no bounds, which is distinguishable from a row that has not been backfilled (all columns null while `date_raw` is set).
- **Old rows.** Readers use `eventDateValue`, which parses `date_raw` when the qualifier is null, so nothing depends on the backfill having run. `npm run db:backfill:dates` (add `-- --remote` for the deployed database) fills them; it leaves `version` and `updated_at` alone.
- **Undo.** Row-op images are generated from the Drizzle columns, so the new columns are in every before and after image. An image written before the migration lacks them and restores as null.
- **Deploy order.** The columns are nullable and defaulted, so the migration is safe before the code. The reverse order is not: the new code inserts the columns. The `deploy` script migrates first, and the request-time check (see `db/schema-status.ts`) answers 503 until every migration in the journal has been applied, so a mis-ordered deploy fails clearly instead of writing to columns that are not there.

