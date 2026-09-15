# Phase 1 — Genealogy core and GEDCOM fidelity

## Objective

Create the smallest correct model for people, unions, parentage and events, then prove it against complex-family fixtures and GEDCOM round trips.

## Prerequisites

Phase 0 identity, migration and service boundaries; reviewed relationship and GEDCOM fixtures.

## Core model

- `person`: identity container, privacy/living-state inputs and record metadata.
- `person_name`: multiple names, types, components, preferred display name and ordering.
- `union`: a partnership/family episode, never inferred to mean marriage.
- `union_partner`: ordered participants with neutral roles; GEDCOM spouse-role metadata is an interchange concern.
- `parent_child`: a direct assertion between two people with type (`biological`, `adoptive`, `foster`, `guardian`, `unknown/other`), optional union context, status, dates, notes and evidence links.
- `event`: typed, repeatable facts for a person or union (`birth`, `death`, `marriage`, `partnership`, `separation`, `divorce`, `annulment`, burial and extensible GEDCOM types).
- `date_value`: retain original GEDCOM text plus parsed lower/upper bounds, precision, calendar and qualifier; never convert `1900` or `ABT 1900` to a fabricated exact day.
- `place_ref` plus literal place text, initially allowing unresolved places.
- Stable ordering and record versions.

Step relationships are derived from a parent's relevant union and are not stored as biological parentage. Widowhood is derived from partner death and union history. Death does not delete or rewrite a union. Multiple unions between the same people remain distinct.

## GEDCOM strategy

1. Build a line/token parser that preserves hierarchy, ordering, payload, pointers, custom tags and unrecognized subtrees.
2. Normalize supported structures into the domain while retaining source-node provenance and XREF aliases.
3. Export supported normalized changes into the preserved document model; carry untouched unsupported structures forward.
4. Target GEDCOM 7 semantics, with an explicit tested GEDCOM 5.5.1 compatibility profile for existing files.
5. Validate pointer integrity, duplicate XREFs, level structure, encodings and supported cardinalities before persistence.
6. Make import staged and atomic: upload, parse, report warnings/errors, preview changes, confirm, commit. Avoid spouse-pair heuristic merges; use explicit identity matching with user review.

## Required scenario tests

- One child has two biological mothers and a separately linked biological father.
- One child belongs to birth and adoptive parental families.
- Foster/guardian relationships coexist with biological parentage.
- Divorce followed by a second union and children in both unions.
- Partner death followed by remarriage, retaining the first union and children.
- A repeated union between the same pair is not collapsed.
- Single/unknown parent and unknown person details.
- Approximate, before/after, range, phrase and conflicting dates.
- Import → export → import preserves supported meaning and untouched unsupported structures.

## Migration

Write an explicit migration/adaptor from current `families`, `family_children`, `individuals` and `events`. Produce a dry-run report for ambiguous mappings and retain a rollback/export path. Do not silently reinterpret existing pedigree values.

## Parallel work

- Domain/schema implementation and invariant tests.
- GEDCOM parser/preserved-tree implementation and corpus tests.
- Date parser/value-object implementation.
- Prototype-data migration analyser.

Integration waits for stable mapping contracts and shared fixtures.

## Exit criteria

- Every required scenario can be created and queried without special-case columns.
- Invariants prevent self-parentage, duplicate identical assertions, cross-tree links and accidental cycles, while unusual but legitimate data yields warnings rather than blanket rejection.
- Supported GEDCOM fixture round trips are semantically equivalent; unsupported structures remain byte-equivalent where feasible or structurally equivalent where rewritten.
- Imports are atomic and report actionable diagnostics.
- No relationship is merged solely because participant IDs match.
