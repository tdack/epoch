# Phase 6 — Charts, reports and interchange

## Objective

Add the highest-value webtrees-like discovery and output capabilities after the data and privacy model are trustworthy.

## Prerequisites

Stable graph queries, privacy policy, evidence model and GEDCOM conformance corpus from Phases 1–5.

## Priority order

1. Production-grade GEDCOM import/export jobs with progress, cancellation, diagnostics, downloadable reports and retained job history.
2. Ancestor/pedigree and descendant charts with configurable generations and relationship-type filters.
3. Relationship chart explaining one or more paths between two people.
4. Fan and hourglass/compact views.
5. Timeline/lifespan view.
6. Printable family group, individual summary, ancestor and descendant reports.
7. Birth/death/marriage anniversaries, recent changes and basic statistics.
8. Branch/clippings export for a selected person and bounded relatives, with privacy enforcement.

All chart/report queries use shared graph and privacy services. Rendering must not reimplement relationship semantics.

## GEDCOM operations

- Detect version/encoding and report extensions before import.
- Keep the original upload and checksum privately for recovery/audit according to retention policy.
- Stream or batch large files within Worker/D1 limits.
- Make retries idempotent and clean up staged R2 objects.
- Provide export profiles: GEDCOM 7 canonical, GEDCOM 5.5.1 compatibility and preserved-source where valid.
- Maintain a conformance corpus and semantic diff report.

## Testing

Use golden semantic outputs for charts/reports, privacy matrix tests and large import/export fixtures. Validate that all representations agree on the same graph filters and do not expose private records through counts or layout.

## Parallel work

After graph query contracts stabilize, each chart/report is an independent stream. Import and export job UX can proceed separately from chart rendering.

## Exit criteria

- Jobs expose reliable status and never produce a partial committed import.
- Charts agree on people, unions, parentage and privacy for the same filters.
- Generated reports are accessible and printable.
- Large-corpus performance targets are measured and documented.
- Exported files pass the project validator and semantic round-trip suite.
