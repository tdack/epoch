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
