# Phase 2 — Relationship-first editor

## Objective

Make complex family entry safe and understandable for non-specialists. This phase completes the relationship MVP.

## Prerequisites

Stable Phase 1 commands, invariants, read models and complex-family fixtures.

## Interaction model

Begin every mutation from intent, not a generic “family” form:

- add parent to this person;
- add child to this person or union;
- add partner/union;
- record marriage, separation, divorce or annulment;
- record death, with clearly explained derived widowhood;
- link an existing person or create a new person;
- change relationship type/context;
- end or remove an incorrect relationship without deleting people.

Use a guided drawer/wizard with a review step. Show the resulting graph sentence before saving, for example: “Alex will be recorded as Sam’s adoptive mother in the Alex–Jordan family.” Keep sex/gender, parent role and relationship type separate.

## UX requirements

1. Search-before-create with duplicate cues: name variants, dates and close relatives.
2. Existing-person and new-person paths in the same flow.
3. Explicit union selection when a parent or child has multiple unions/parental groups.
4. Per-parent relationship type rather than one pedigree selector for an entire family.
5. Clear handling for unknown second parent and intentionally single-parent records.
6. Timeline-aware prompts for divorce, death and remarriage without blocking uncertain or exceptional histories.
7. Preview affected people/unions, warnings and permissions before commit.
8. Undo the last safe mutation through compensating domain commands; destructive actions require impact summaries.
9. Keyboard, mobile and screen-reader support with focus management and inline errors.
10. Optimistic conflict handling that shows what changed instead of overwriting it.

## Graph presentation

Refactor the canvas to consume a read-only relationship graph. Display separate union nodes, multiple parentage lines, relationship type legend, divorce/separation markers and deceased indicators. Allow choosing a focus person, ancestor/descendant depth and included relationship types. Never normalize away repeated unions or single-parent groups.

A person detail panel summarizes parents by type, partners/unions chronologically, children grouped by union/context and derived step relationships.

## Validation and migration

Keep old family dialogs read-only during a short transition, then remove them after equivalent commands pass fixture tests. Run task-based usability checks using every Phase 1 scenario. Assertions cover both persisted graph and human-readable preview. Add end-to-end tests for destructive paths and ambiguous selections.

## Parallel work

- Intent-based editor components against mocked command contracts.
- Relationship graph query/layout and visual legend.
- Duplicate-person search endpoint.
- Mutation impact/undo service.

## Exit criteria

- A user can enter all core scenarios without editing raw GEDCOM or understanding `FAM` records.
- Every save preview matches the resulting graph.
- Removing a union/relationship cannot silently delete a person or unrelated history.
- Multiple mothers, multiple parental families, divorce/death and remarriage remain visually distinguishable.
- Targeted component, domain and browser tests pass, including keyboard-only flows.

## Status against the exit criteria

Closed after the work that followed slice S4 (2026-09-30); the roadmap shows Phase 2 as *Complete*.

| Criterion | Status | Evidence |
|---|---|---|
| A user can enter all core scenarios without editing raw GEDCOM or understanding `FAM` records | Met | `e2e/scenarios.spec.ts` builds each Phase 1 scenario through the dialogs alone: two mothers and a father; birth and adoptive parents with foster and guardian links; divorce then a second partnership with a deliberate partnership choice; death then remarriage; partnering again after a divorce; a single or unknown parent; approximate, before, after, range and phrase dates. Running it found and fixed a dialog that wiped a half-filled form when the graph reloaded, and a remarriage the planner refused. Changing an existing link's type is now an intent (`change_link_type`) with a preview and undo. |
| Every save preview matches the resulting graph | Met | Service tests plan an intent, run it and compare the sentence and the records, for add parent, child and partner (including a chosen partnership), change link type, death, end partnership and remarriage. The merge and delete dialogs list the same ops they write. |
| Removing a union or relationship cannot silently delete a person or unrelated history | Met | Service tests and the destructive Playwright specs. |
| Multiple mothers, multiple parental families, divorce, death and remarriage stay visually distinguishable | Met | Line styles per relationship type, ended-partnership connectors, † and widowhood, "1st/2nd partnership" labels and step relatives in the drawer. |
| Targeted component, domain and browser tests pass, including keyboard-only flows | Met | Domain and service tests; jsdom component tests for the parent-link popover, the partnership chooser (including the reload regression), the drawer's step relatives and sex label; Playwright specs including keyboard-only flows, axe (WCAG 2.1 A and AA) on the tree, the relationship dialog and the drawer, and a 375px run. |

Limits worth knowing. The screen-reader and phone checks are automated: axe and ARIA assertions (dialogs announced, the choice a labelled group, the preview a live region, errors as alerts, saved changes as a status) and a 375px viewport run for sideways scroll, dialog fit and 24px targets. Nobody has yet used the editor with VoiceOver or TalkBack, or on a physical phone; Phase 8's accessibility pass owns that. The old family dialogs are gone: no family form, route or endpoint remains, and the last two types from them (`FamilyFormData`, `FamilyRecord`) were removed.
