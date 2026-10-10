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

The residuals the review accepted are listed below. The other work items are not started.

## Known issues and accepted residuals

Accepted by the security review of `fix/security-media-xss-auth` (ADR-039) unless noted. None is a
release blocker for the current scope.

- **An oversized body with no declared length is buffered before the size check.** A chunked or
  length-less upload is parsed by `request.formData()` before the parsed `file.size` is checked, so
  the whole body is buffered first. It is bounded by the platform's request-body limit and reachable
  only by an authenticated uploader with `media:manage`. The 64 KB slack in the pre-parse
  `Content-Length` check is not a size bypass: the parsed size is authoritative.
- **Malformed multipart answers 500.** `request.formData()` in the upload route is called outside
  the route's `try`, so a body that is not valid multipart surfaces as a 500 rather than a 400.
  Moving the call inside the `try` and mapping it to a `ValidationError` is the fix.
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

### Planned GEDCOM export follow-ups

The two GEDCOM export items from this review, tracked together.

- **GEDCOM exporter injection (deferred).** The review found that a stored text value containing a
  line break can inject an extra line into a GEDCOM export. This is a known issue to be fixed on a
  dedicated follow-up branch; no branch or issue link exists yet.
- **The export UI bypasses the export workflow (planned task).** The `GEDCOM_EXPORT_WORKFLOW`
  binding and `GedcomExportWorkflow` class exist and are configured (`wrangler.deploy.jsonc`,
  `workers/entry.ts`), but the workflow is dispatched only by the `POST /api/export` handler
  (`src/routes/api/export/+server.ts`), and no client code calls that POST. The UI export action
  instead performs a synchronous navigation to `GET /api/export` (`TreeShell.exportGedcom` in
  `src/lib/components/tree/tree-shell.svelte.ts`, via `gedcomExportUrl` in
  `src/lib/services/tree-api.ts`), so every export serializes the whole tree in-request and the
  asynchronous workflow path is effectively dormant. Goal: route large exports through the workflow
  (async), keeping the synchronous download for small or fast cases as appropriate; decide whether
  to keep or remove the inline fallback on the POST.
