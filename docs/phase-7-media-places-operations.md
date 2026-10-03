# Phase 7 — Media, places, maps and operations

## Objective

Add lower-priority artifacts and geographic discovery without weakening privacy or delaying the relationship core.

## Prerequisites

Phase 4 privacy/authorization and Phase 5 evidence attachment contracts.

## Media and documents

1. Store private originals in R2 with opaque keys; authorize every read through the application.
2. Model media metadata, ownership, dates, notes, citations and links to multiple records/facts.
3. Validate MIME/signature, size and image dimensions; generate safe derivatives asynchronously.
4. Support photographs and scanned documents such as certificates, with transcription/citation workflows.
5. Add galleries, record thumbnails, ordering, captions and download permissions.
6. Define retention and orphan cleanup for uploads, imports and exports.

## Places and maps

1. Normalize hierarchical places while retaining the exact historical place text on each event.
2. Allow aliases, historical names, coordinates and confidence/provenance.
3. Add place search, hierarchy/list and record-linked place pages.
4. Add event maps, then ancestor/pedigree maps only after place quality is adequate.
5. Keep third-party geocoding optional and prevent private-person details from being sent externally.

## Operations

- D1 recovery/runbook using Time Travel, tested exports and restore exercises.
- R2 lifecycle, checksums and backup policy.
- Job dashboards, structured operational logs and storage/cost metrics.
- Configuration separation for development/staging/production and reproducible provisioning.

## Testing and migration

Migrate current media objects by inventorying ownership, checksum, MIME and dangling links before changing keys. Exercise authorization on originals and derivatives. Test historical-place merges without replacing literal event text.

## Parallel work

Media/document and place/map workstreams are independent behind shared privacy and evidence interfaces. Operational runbooks can proceed throughout both.

## Exit criteria

- Private media cannot be fetched with a guessed or stale URL.
- Media processing is idempotent and untrusted files are handled safely.
- Historical place labels are never overwritten by geocoding normalization.
- Maps obey the same privacy policy as records and charts.
- A documented restore exercise succeeds for D1 and required R2 assets.

## Status

Not started as a phase (the roadmap shows *Planned*). Earlier slices laid groundwork: media upload
and attach already exist, S8 (ADR-015) made every media read check the tree, the record and
the viewer's role, and S11 (ADR-019) added place records derived from each fact's text, with rename
and merge. Place hierarchy, maps, media records (`OBJE` is retained) and the operations work wait.
