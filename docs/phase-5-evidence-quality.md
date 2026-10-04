# Phase 5 — Evidence, notes and data quality

## Objective

Move from a relationship database to evidence-capable genealogy while preserving uncertainty and disagreements.

## Prerequisites

Phase 1 GEDCOM/domain foundations, Phase 3 record UI and Phase 4 privacy/audit services.

## Work

1. Add GEDCOM-aware source, repository, citation and note records, including shared notes.
2. Attach citations and notes to people, unions, relationships, names and individual facts/events.
3. Citation fields include source, page/locator, transcription/text, access date, quality/assessment and linked media.
4. Show evidence alongside each assertion and distinguish sourced, unsourced and conflicting claims.
5. (Built in S14, ADR-022.) Build duplicate-person comparison and explicit merge with field-by-field review, relationship impact preview and reversible audit history.
6. (Built in S13, ADR-021; unsourced key facts added in S15b, ADR-028; privacy leaks in S15c, ADR-029.) Add data-quality checks: impossible/implausible chronology, dangling pointers, duplicate relationships, cycles, event ordering, missing parent context, unsourced key facts and privacy leaks.
7. (Built in S13.) Classify checks as errors, warnings or research suggestions. Do not reject unusual histories merely because they are statistically unlikely.
8. Add research tasks/to-do items attached to records and quality findings.
9. Extend GEDCOM import/export and conformance tests for sources, citations, repositories and notes.

## Migration and testing

Convert existing free-text notes without inventing source links. Preserve imported citation order and unsupported qualifiers. Use known-good and deliberately unusual fixtures to guard against culturally narrow or overly strict quality rules.

## Parallel work

- Evidence schema/domain and GEDCOM mapping.
- Citation/note editing and display.
- Data-quality rule engine and fixtures.
- Merge comparison/impact UX after command contracts stabilize.

## Exit criteria

- A key relationship or event can be supported by multiple citations and notes.
- Conflicting assertions remain independently visible and attributable.
- Merge never relies only on names and dates and never silently loses links/evidence.
- Quality findings are deterministic, explainable, dismissible with reason and privacy-aware.
- Evidence records survive supported GEDCOM round trips.

## Status against the work items

Complete (2026-10-04); the roadmap shows Phase 5 as *Complete*. S13 (quality report), S14 (person
merge), S15a (lossless evidence round trip), S15b (sources, repositories and citations) and S15c
(notes, research tasks and privacy leaks) are done and deployed; see ADR-021, ADR-022, ADR-023,
ADR-028 and ADR-029 and the [S15b](./improvement-plan.md#s15b-sources-repositories-and-citations)
and [S15c](./improvement-plan.md#s15c-notes-and-research-tasks) status sections.

| Work item | Status |
|---|---|
| 1. Source, repository, citation and note records | Done: sources, repositories and citations (S15b); notes, inline and shared (S15c). |
| 2. Citations and notes on people, unions, relationships, names and facts | Done: citations on all five subjects (S15b); notes on those and on sources, repositories and citations (S15c). Repositories have no notes screen yet. |
| 3. Citation fields | Source, page, quality, data date and text done (S15b). A citation's `OBJE` is retained, not linked to media. |
| 4. Evidence beside each assertion; sourced, unsourced and conflicting | Done (S15b), in the person view and on the partnership page. |
| 5. Duplicate-person comparison and merge | Done (S14); merges carry citations (S15b), notes and tasks (S15c). |
| 6. Data-quality checks | Done (S13), with unsourced key facts (S15b) and privacy leaks for managers (S15c). |
| 7. Errors, warnings and research suggestions | Done (S13). |
| 8. Research tasks | Done (S15c): on records and quality findings, privacy-aware; Epoch's own and not exported (an imported `_TODO` stays retained). |
| 9. GEDCOM import/export for evidence | Done: sources, repositories, citations (S15b) and notes (S15c) in 5.5.1 and 7.0; everything else retained losslessly (S15a). |
