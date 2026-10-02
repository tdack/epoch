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
6. (Built in S13, ADR-021, except unsourced facts and privacy leaks.) Add data-quality checks: impossible/implausible chronology, dangling pointers, duplicate relationships, cycles, event ordering, missing parent context, unsourced key facts and privacy leaks.
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
