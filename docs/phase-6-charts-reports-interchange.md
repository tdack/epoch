# Phase 6 — Charts, reports and interchange

## Objective

Add the highest-value webtrees-like discovery and output capabilities after the data and privacy model are trustworthy.

## Prerequisites

Stable graph queries, privacy policy, evidence model and GEDCOM conformance corpus from Phases 1–5.

## Priority order

1. Production-grade GEDCOM import/export jobs with progress, cancellation, diagnostics, downloadable reports and retained job history.
2. Ancestor/pedigree and descendant charts with configurable generations and relationship-type filters. (Built in S10, ADR-017.)
3. Relationship chart explaining one or more paths between two people. (Built in S10, ADR-017.)
4. Fan and hourglass/compact views. (S12 built the fan and the hourglass, ADR-020; compact remains.)
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

## Status

The roadmap shows Phase 6 as *In progress*. Items 2 and 3 were built in S10 and the fan and
hourglass in S12. Two optional 3D views of the interactive tree (layers and floors) are slice S16
(ADR-030): all nine stages are built, merged and deployed (2026-10-05). Flat stays the product
default until the promotion checklist in the [plan](./3d-tree-views-plan.md) is met; members and the
owner can choose a different default view. Item 1 gained an asynchronous path on 2026-10-11
(`feat/gedcom-export-and-workflow`, ADR-040): a tree at or below 5,000 people exports in the request,
and a larger tree (up to 50,000) runs through `GedcomExportWorkflow` behind a started/polled/download
client, with a 24-hour read-time expiry and an `exports/` R2 lifecycle rule. Progress reporting is a
status poll; cancellation, diagnostics, downloadable reports and retained job history have not
started, and items 5 to 8 and the compact view have not started. Of the GEDCOM operations, import
now detects the version (5.5, 5.5.1, 7.0) and the character set and reads GEDZip, and export offers
GEDCOM 7 (the default, optionally as `.gdz`) and 5.5.1 compatibility profiles (ADR-036); exported text can no
longer inject a GEDCOM line (ADR-040); and `@`-escaping and the 7.0 forbidden control set are handled
at build time in both dialects, with the tree name round-tripping (ADR-042). Extension reporting
before import, keeping the original upload, the conformance corpus and the semantic diff report have
not started.
