# Phase 8 — Release hardening

## Objective

Apply continuous quality gates and complete a final release-readiness pass for the selected feature scope.

## Prerequisites

A declared release scope and candidate containing the selected outcomes from earlier phases.

## Work

1. Threat-model identity, authorization, privacy inference, import parsers, uploads, R2 delivery, exports and destructive commands.
2. Test authorization at every route, server action, queue consumer and workflow step; add CSRF/origin protections where applicable and secure response headers.
3. Fuzz/mutation-test GEDCOM parsing and enforce size/depth/count limits to prevent resource exhaustion.
4. Accessibility audit to WCAG 2.2 AA for navigation, editors, dialogs/drawers, graph alternatives, contrast, focus and reduced motion.
5. Performance tests with small, medium and agreed large trees; profile D1 reads/writes, pagination, graph layout and job memory/time.
6. Resilience tests for queue retries, duplicate delivery, workflow failure, migration interruption and concurrent edits.
7. Production observability: privacy-safe structured logs, error tracking, job alerts and operational dashboards.
8. Documentation: deployment, Access setup, role model, backup/restore, migration, import diagnostics, privacy behavior and collaborator guide.
9. Release migration rehearsal from the current prototype and rollback procedure.
10. Dependency/license review and removal of dead prototype paths.

## Validation matrix

Run repository `check`, `test` and `build` scripts in production-compatible configuration, targeted security/privacy tests, browser accessibility checks, restore rehearsal and smoke tests against both a fresh deployment and upgraded prototype snapshot.

## Parallel work

Security, accessibility, performance and operational documentation can run in parallel against a release candidate. Findings return to owning phases; this phase does not hide unresolved correctness defects.

## Exit criteria

- No known critical/high security or privacy issue remains.
- Core workflows meet WCAG 2.2 AA or have documented, approved exceptions.
- Defined scale tests meet recorded budgets with no whole-tree API dependency.
- Backup/restore, migration rollback and failed-job recovery are rehearsed.
- Fresh deployment and prototype upgrade both pass smoke tests.
- User/admin documentation matches shipped behavior.

## Status

Security hardening landed on 2026-10-10 (`fix/security-media-xss-auth`, ADR-039) against work
items 1 and 2:

- **Uploads and R2 delivery.** Media uploads are sniffed from their magic bytes, capped at 25 MB,
  and served through a `Content-Type` allowlist (`mediaServeDecision`). Every served object response
  carries `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`,
  `Cross-Origin-Resource-Policy: same-origin` and `Referrer-Policy: no-referrer`. The stored R2 type
  is never replayed, and the D1 `media_items.mime_type` column is off the serve path.
- **Identity.** The Access audience check fails closed when `CF_ACCESS_AUD` is unset, and is read
  from `$app/env/private` with a Worker-binding fallback. The JWKS fetch has a 3-second timeout, a
  bounded single refetch on an unknown `kid`, no cross-request coalescing, and fails closed on a
  certs outage.

GEDCOM export hardening and the asynchronous export landed on 2026-10-11
(`feat/gedcom-export-and-workflow`, ADR-040) against work items 1, 2 and 6, and 8 in part:

- **Exporter injection.** An exported text value can no longer forge a GEDCOM line. Every terminator
  (`\r\n`, `\r`, `\n`, `\v`, `\f`, `\x1c`–`\x1e`, `\x85`, `\u2028`, `\u2029`) splits a multi-line
  value into `CONT` lines; a field that must occupy one line folds every terminator to a space; a tag
  or xref carrying a terminator is refused; and the write boundary (`schemas.ts`) rejects a line break
  in a single-line field. A stray non-GEDCOM segment is retained as a `CONT` rather than dropped.
- **Asynchronous export.** A tree above 5,000 people exports through `GedcomExportWorkflow` when the
  binding exists, up to 50,000; above that a `413`. The threshold does not raise the memory ceiling:
  the workflow runs the same serialization in another request, so the ceiling is enforced on both
  paths. A status read returns a closed `{ status, code }` and never a raw error or the object key.
- **Expiry and cleanup.** A finished export is downloadable for 24 hours, enforced at read time
  (`customMetadata.uploadedAt`, falling back to R2's `uploaded`); past that it answers
  `410 export_expired` and deletes the object. The setup tool writes an `exports/`-scoped R2
  lifecycle rule (read-merge-write, abort-only rules ignored, a rule that could touch `media/`
  refused), and `doctor` fails on any delete rule that could expire live media. See ADR-040.

The dialect hardening and the tree-name round trip followed on 2026-10-11
(`fix/gedcom-dialect-and-tree-name`, ADR-042); see [GEDCOM export follow-ups](#gedcom-export-follow-ups).

The residuals the review accepted are listed below. The other work items are not started.

## Known issues and accepted residuals

Accepted by the security review of `fix/security-media-xss-auth` (ADR-039) unless noted. None is a
release blocker for the current scope.

- **A legitimate file accompanied by ≥64 KB of other form fields is refused.** The upload body is
  now bounded while it streams, by a byte-counting `TransformStream` in `parseUploadForm`
  (`src/routes/api/media/upload/+server.ts`): it aborts once the body passes
  `MAX_MEDIA_UPLOAD_BYTES + 64 KB` of multipart slack and then parses the bounded stream, so an
  oversized body with no declared length is no longer buffered whole. A declared `Content-Length`
  beyond that bound is still refused before the body is read, as a cheap early exit. The 64 KB slack
  covers multipart framing, so a well-formed file accompanied by ≥64 KB of other form fields is
  refused with a 413. `assertUploadWithinSizeLimit(file.size)` remains the authoritative *file* cap.
- **A merged person leaves a stale media key.** Person merge moves `media_items` rows but does not
  rewrite the R2 object key, which embeds the original entity id. A restricted viewer who can see
  the surviving person gets a false 404 on the moved media, because `requireRead` parses the old
  entity id from the key and finds no owner. Viewers who are not restricted are unaffected.
- **Tree deletion orphans R2 objects.** `media_items.tree_id` cascades in D1, but the R2 objects are
  never deleted, so they leak storage and cannot be read back by key. A lifecycle rule or a
  delete-time sweep is needed.
- **HEIC and `mif1`-brand AVIF files are rejected.** The sniffer recognizes an ISO-BMFF file only
  when the major brand at offset 8 is `avif` or `avis`. A HEIC file, or an AVIF whose major brand is
  `mif1`, is refused. This is a product note for the release notes; extending the sniff is a small
  follow-up.
- **`JWKS_MAX_STALE_MS` is inert on the TTL path.** The 24-hour staleness bound is consulted only in
  `fetchJwksForUnknownKid` (the unknown-`kid` path). When the 10-minute TTL expires, `fetchJwks`
  calls the certs endpoint directly and fails closed on an outage, with no stale fallback. The
  constant has no effect there. Noted, no behavior change.

### GEDCOM export follow-ups

The two GEDCOM export items from this review both shipped on 2026-10-11
(`feat/gedcom-export-and-workflow`, ADR-040); the follow-ups below are what remains.

- **GEDCOM exporter injection (done).** The review found that a stored text value containing a line
  break could inject an extra line into a GEDCOM export. The full terminator set now splits a
  multi-line value into `CONT` lines, single-line fields fold a terminator to a space, a tag or xref
  carrying one is refused, and the write boundary rejects a line break in a single-line field. The
  `@`-escaping, 255-character `CONC` wrapping and general C0-control stripping are not part of this
  fix; see the dialect-hardening follow-up below.
- **The export UI bypasses the export workflow (done).** The client now calls `POST /api/export`
  (`startGedcomExport` in `src/lib/services/tree-api.ts`), which answers `sync` for a small tree
  (the browser then navigates to `GET /api/export`) and otherwise starts a `GedcomExportWorkflow`
  instance the client polls and resumes (`TreeShell.exportGedcom` and `resumeExport` in
  `src/lib/components/tree/tree-shell.svelte.ts`). The inline synchronous fallback is kept only for
  a tree at or below 5,000 people; there is no synchronous fallback for a large tree that the
  workflow cannot run.

Done in the follow-up (`fix/gedcom-dialect-and-tree-name`, 2026-10-11, ADR-042):

- **GEDCOM dialect hardening (done).** `@`-escaping and general C0-control stripping now happen at
  build time: a model text's leading `@` is doubled where its line is built, in both dialects; the
  import reads the escape from the raw bytes and unescapes the owning line and its `CONT`s but never
  a `CONC`; and the 7.0 forbidden control set (C0 except TAB/LF/CR, DEL, C1, unpaired surrogates,
  U+FFFE/U+FFFF) is stripped. The dialect post-pass converts only. **5.5.1 `CONC` wrapping at 255
  bytes is deferred:** no reader in scope needs it.
- **The tree-name round trip (done).** Export writes `1 NOTE Tree: <name>` and import reads it back
  through a version-guarded conditional rename, with precedence explicit name > embedded `Tree:` >
  filename > `HEAD.FILE`, logged as one `import_tree_name` change.

Parked, deliberately not planned:

- **An export audit.** An export writes no audit entry. It does not fit `change_log`, which ADR-007
  scopes to tree content for undo, and the owner does not want that level of accountability or
  tracing, so a dedicated account-level audit table and migration is deliberately not planned. See
  the former `TODO(audit)` note in `src/routes/api/export/+server.ts`.
