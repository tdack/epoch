# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A family that shares the work of keeping its history. The owner runs the deployment and invites
relatives and researchers, each with a tree role (`owner` > `manager` > `editor` > `contributor` >
`viewer`). Several of them actively edit: adding people, facts, names, sources and corrections,
and following one another's changes. Collaboration and change review matter as much as solo
research. Viewers browse, look people up and explore the charts.

## Product Purpose

Epoch keeps one private family history that the people who know it can build together, without
handing it to a platform. Success is a collaborator safely creating, and anyone with access
understanding, a tree with real-world complexity: more than one parental family, adoptive, foster,
guardian and unknown parentage, step relationships, partnerships with separation, divorce, death
and remarriage, and incomplete, approximate or conflicting dates. It is inspired by webtrees'
capabilities, not its screens or implementation.

## Positioning

- **Private and self-owned.** Each family runs its own Cloudflare deployment. Access is by
  invitation only, identity comes from Cloudflare Access, roles and living-person privacy are
  Epoch's own. No platform owns or mines the data.
- **Contemporary, serverless and at the edge.** Built on Cloudflare Workers, D1, R2, Queues and
  Workflows, so it is fast and available everywhere with no server to maintain.

## Operating Context

- Signed-out visitors land on `/welcome` and sign in through a Cloudflare Access application that
  covers only `/login`.
- Work centres on a tree: record pages for people, unions and places, a relationship-first editor,
  search, recents and favourites, charts (pedigree, descendants, relationship, fan, hourglass, and
  the 3D layers and floors views), sources and citations, notes, tasks, a data-quality report,
  members and invitations.
- GEDCOM files move in and out: import with validation and preview, export in 5.5.1 and 7.0.
- Changes are logged and undoable; edits use optimistic concurrency, so collaborators can conflict.

## Capabilities and Constraints

- The neutral relationship model (person, name, union, union partner, parent-child assertion,
  event, date value) is the source of truth. A union never implies marriage; death never deletes a
  union; dates are never rounded into a fabricated exact day.
- GEDCOM round-trips every supported structure without loss; unsupported structures are retained
  for export.
- Every endpoint denies by default; privacy masks living and private people per viewer.
- Phase status lives in `docs/roadmap.md`. Still open: audit, contributor suggestions and record
  history (Phase 4); reports, timelines and production import/export jobs (Phase 6); media,
  documents and maps (Phase 7); release hardening (Phase 8).
- `docs/phase-8-release-hardening.md` targets WCAG 2.2 AA for core workflows. Phone layouts are
  already built and covered by e2e tests; how far phones are a primary surface is undecided.

## Brand Commitments

The current brand is settled and must be kept:

- The name **Epoch**.
- The Epoch mark (`src/lib/components/brand/EpochMark.svelte`, `static/brand/icon*.svg`).
- The tagline: "A private family history, shared with the people who help keep it."
- The welcome splash (`src/lib/components/brand/Splash.svelte`) with its library photograph
  (`static/brand/splash-library.*`) and emerald identity (theme colour `#064e3b`).
- Plain, precise voice: copy says exactly what happens ("Access is by invitation. Sign in with the
  address your invitation was sent to.").

## Evidence on Hand

- Fixture trees: `docs/The_Simpsons.ged`, `docs/The_Simpsons_clean.ged` (seeded as "The Simpsons"),
  `docs/The_Names_fixture.ged`.
- Brand assets in `static/brand/` (icons, maskable and monochrome icons, Open Graph image, splash
  photograph, web manifest).
- Architecture decisions in `docs/decisions.md` (ADR-001 onward).
- There are no testimonials, user counts, benchmarks or public deployments to cite; none may be
  invented.

## Product Principles

1. **Model the family as it was, not as a form expects.** Relationships, parentage and dates keep
   their real complexity and uncertainty; the interface makes that understandable rather than
   flattening it.
2. **Evidence is never overwritten.** Conflicting assertions, names and sources stay side by side,
   and every change can be traced and undone.
3. **Shared work, safe edits.** Several people edit the same tree; roles, conflicts and undo make
   that safe and visible.
4. **Private by default.** Living people and private records stay hidden from those without the
   right; nothing is public unless deliberately made so.
5. **The family owns its history.** Self-hosted, lossless GEDCOM in and out, no lock-in.
