![Epoch Genealogy](static/brand/og-image.png)

# Epoch Genealogy

A private family-tree application for one owner and the relatives and researchers they invite.
Each family runs its own copy on its own Cloudflare account, so no platform holds or mines the
data. Epoch is inspired by webtrees' capabilities, not its screens.

## Features

### A family tree that handles real families

- **More than one family per child.** A child can have more than one mother, father or parental
  family, each link typed as biological, adoptive, foster, guardian or unknown.
- **Partnerships, not just marriages.** Married and unmarried partners, separation, divorce,
  annulment, death, widowhood and remarriage. Repeated partnerships between the same two people
  stay distinct and are labelled "1st partnership", "2nd partnership", with dates.
- **Step relationships** are worked out from a parent's partnerships rather than entered by hand.
- **Honest dates.** Approximate, ranged, incomplete and conflicting dates are kept as written;
  `ABT 1900` never becomes an invented exact day.
- **Several names per person**, with types, components and a preferred display name, plus
  repeatable facts and events for people and partnerships.

### Exploring the tree

- A focus-centred family view where generations up and down, siblings, step relatives and
  relationship types can be shown or hidden. The view is kept in the address, so reloading,
  **Back** and shared links restore it.
- **3D views** beside the flat view: **Rings** (one ring per generation), **Ball** (height is
  calendar time), **Ribbons** (lines of descent braiding at each partnership) and **Orrery**
  (partners as paired stars). Each can show the whole tree and trace several lines at once.
- **Charts** centred on any person: pedigree, descendants, fan and hourglass, each with a text
  outline.
- **Relationship finder** showing every route between two people.
- **Ranked search** over names, record ids, places and years, saying why each person matched.
- **Lists** of people, partnerships and surnames, paged on the server, plus recents and favourites.

### Records and research

- **Person pages:** names, facts (add, edit, remove, reorder), family, evidence, media and history.
- **Partnership pages:** partners, events, children, chronology, evidence and warnings.
- **Places** named by facts, with rename and merge.
- **Sources, repositories and citations**, showing what each source supports.
- **Shared notes**, and where each one is used.
- **Research tasks** with filters.
- A **data-quality report** that flags likely mistakes, with dismissals.
- **Media** attached to people, kept private in your own storage.

### Editing safely together

- **Roles per tree:** owner, manager, editor, contributor and viewer.
- **Invitations.** Only the install owner, tree members and people with an open invitation can get
  in. Anyone else who signs in is told to ask the owner for an invitation, and nothing is stored
  about them.
- **Living-person privacy**, configured per tree by its managers.
- **Undo.** Every change is recorded in a change log, and each one shows a toast with **Undo**. Undo
  reverts your own latest change, and says why if someone else has since changed the same records.
- **Conflict protection.** If two people edit the same record at once, the second save is refused
  rather than overwriting the first.
- **Delete with impact.** Removing a person or link first shows exactly what will be affected.

### GEDCOM import and export

- Import with validation and a **preview** before anything is written.
- **Duplicate families** in a messy file (same two partners, identical facts, no disagreement about
  a child) are offered for merging, on by default; **possible duplicates** are listed for review.
- **Merge duplicate partnerships** already in a tree from a partnership's menu, or **Merge…** in the
  person drawer. The dialog lists what moves or goes and asks you to choose where the facts differ.
  Merges can be undone.
- Export writes the tree back out, including structures Epoch does not yet show, which are kept
  from the import rather than discarded. Merged families keep their original ids.

## Getting started

To run Epoch on your own machine or install it into your own Cloudflare account, follow
[INSTALL.md](./INSTALL.md).

## Developing Epoch

Commands, tests, deploy internals and data backfills are in
[docs](https://github.dack.com.au/epoch/) and [docs/development.md](./docs/development.md).

## Licence

Copyright (C) 2026 Troy Dack.

Epoch is free software: you can redistribute it and/or modify it under the terms of the GNU Affero
General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version. It is distributed in the hope that it will be
useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE. See [LICENSE](./LICENSE) for the full terms.

If you run a modified copy that other people use over a network, the licence asks you to offer them
its source code (section 13).

The GEDCOM files under `test/data/` were generated by a language model as test data, not taken
from anyone's research, and are covered by the same licence.
