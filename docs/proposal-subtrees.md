# Proposal: sub-trees of a tree

- **Status:** accepted as [ADR-062](./adr/ADR-062.md), built 2026-10-18 on
  `claude/tree-subtrees-exploration-dcc030` and deployed. Where this proposal and the built code
  differ, the ADR and the code are the source of truth. Open follow-ups are in
  [backlog.md](./backlog.md).
- **Goal:** a manager marks a person as the root of a named sub-tree ("Bouvier line", rooted at
  Clancy Bouvier). The sub-tree appears indented under its tree in the tree switcher.
  Choosing it opens the chart on the root, and the people, surname, union and place lists, search
  and the person finder show only the sub-tree's members. The rest of the tree stays one click away
  and is still fully editable.
- **Decided with the owner (2026-10-18):** a *lens* (root plus scoped lists, not an access
  boundary); members are the root's *descendants plus their partners*; sub-trees belong to the
  *tree* and are managed by managers and above; created *from the person*, managed on the *Trees
  page*, and each has *its own address*.

## Example

A tree holding several families that marry into each other has a natural sub-tree for each
family's apex. In the seeded Simpsons test tree (`test/data/The Simpsons.ged`), a "Simpson line"
rooted at Abraham Simpson holds Abe's descendants and their partners (Marge among them), and a
"Bouvier line" rooted at Clancy Bouvier holds Marge, Patty and Selma and their partners (Homer
among them). The two overlap where the lines marry; a person can be in several sub-trees.

## Design

### Data

A new table in its own migration (expand only):

```
subtree
  id               text pk
  tree_id          text not null  → trees.id ON DELETE CASCADE
  name             text not null
  slug             text not null  -- isValidTreeSlug; unique (tree_id, slug)
  root_person_id   text not null  -- no FK: see "Lifecycle"
  position         integer not null default 0
  version          integer not null default 1
  created_by, created_at, updated_at
```

Membership is **computed, not stored**. A stored member table would have to be rebuilt by every
`parent_child`, `union_partner` and person mutation; a recursive CTE over indexed edges costs one
query per scoped read on trees of this size. Revisit with a measured plan if a tree grows past
tens of thousands of people.

**Who is in a sub-tree rooted at R:**

1. R.
2. Every child of a member, through `parent_child` of **any type** (biological, adoptive, foster,
   guardian, unknown) whose status is not `disputed`. The neutral model treats an adopted child as
   part of the line; a disputed link does not pull a family in.
3. Every partner (`union_partner`) of anyone in 1 or 2. Partners' own parents and kin are **not**
   members.

The recursion uses `UNION` (not `UNION ALL`) so a cycle in bad data terminates.

As SQL, a fragment in the style of `repositories/visibility.ts`:
`inSubtree(alias, subtreeId)` → `AND <alias>.id IN (WITH RECURSIVE line(id) AS (…) SELECT …)`. It
sits beside `tree_id` and is ANDed with the visibility predicate, so totals, `hasMore`, page fill,
surname counts and ordering are all computed in scope, never by filtering a finished page. It binds
two parameters (tree id, root id), well inside D1's 100-parameter cap. A plan test in the style of
`list-plans.test.ts` holds it to the `idx_parent_child_parent` and union-partner indexes.

### Addressing

The sub-tree rides **inside the tree's path segment**: `/trees/dacks~bouvier-line/people`.

- `~` cannot appear in a slug or a UUID, so `<tree>~<subtree>` is unambiguous, and
  `encodeURIComponent` leaves it alone.
- Every positional path check in `hooks.server.ts` and `http/tree-host.ts`
  (`treeIdOfPath`, `split('/')[3]`, `publicReadAccess`, the sign-in `next`) keeps working; ADR-057
  rejected `reroute` because `event.url` keeps the original path and those checks would all need
  translating. A separate `/~sub/` segment would break them the same way.
- One helper, `splitTreeSegment(segment) → { tree, subtree | null }`, in `shared/tree-slug.ts`, is
  the only place that knows the separator. The tree resolvers (`treeLoad`, `treeHandler`, the host
  checks, `canonicalTreeAddress`) call it.
- **The API accepts the same segment**: `/api/trees/dacks~bouvier-line/lists/individuals`.
  `treeHandler` resolves the sub-tree and puts it on the context (`ctx.subtree`). Page loads already
  pass `params.id` to the API, so scoped reads need no extra client plumbing; endpoints that are
  not scoped ignore `ctx.subtree`. Writes keep using the tree's id.
- An unknown sub-tree slug, or one whose root the viewer may not see, is a 404 (no hint that it
  exists).
- The canonical redirect keeps the sub-tree: `/trees/<uuid>~<sub-uuid>` → `/trees/dacks~bouvier-line`.
- A tree host serves it the same way: `dacks.example.com/trees/dacks~bouvier-line`.

`TreeRef` gains `subtree?: string | null` (the segment form, slug or id). The layout sets
`summary.tree.subtree` to the active one, so every link built with `treePath(data.summary.tree)` (42
call sites) keeps the lens without change. "Show whole tree" links pass `subtree: null`.

### What the lens scopes

| Scoped to members                                              | Not scoped (tree-wide)                                |
| -------------------------------------------------------------- | ----------------------------------------------------- |
| Chart default focus (the root)                                 | Sources, repositories, notes, files, tasks            |
| Whole-tree chart mode (members only)                           | Quality, privacy, members, settings                   |
| People, surnames, unions and places lists                      | Writes of any kind                                    |
| Search and the person finder                                   | Change log, undo                                      |
| Header counts (`Bouvier line · 58 people`)                    | GEDCOM export (exports the whole tree)                |

A person page for someone outside the lens is still shown, with a quiet "Not in Bouvier line"
note and a link to the whole tree. The chart can still be navigated past the lens's edge (a
partner's parents): the lens chooses where you start and what lists show, it does not hide
relatives.

**Chart focus order** in a sub-tree: the URL's `focus` → the focus remembered *for this sub-tree*
(localStorage key `…:<treeId>~<subtreeId>`) → the sub-tree's root → the tree's default.

A banner under the header names the lens: "Bouvier line · anchored at Clancy Bouvier ·
Show whole tree".

### Switcher

`TreeSwitcher` is a custom menu (`menuitemradio`), so a sub-tree is an indented `menuitemradio`
under its tree, with the tree itself still selectable. **Only the current tree's sub-trees are
listed** (they come with its summary); listing every tree's sub-trees would make the tree-list
endpoint resolve visibility for every tree. That is a follow-up if wanted.

### Privacy

The sub-tree list is filtered per viewer: a sub-tree whose root the viewer may not see (a living
person, for a contributor or viewer) is left out of the list and its address is a 404. Its name
could otherwise reveal the person. Public visitors get no sub-tree entries in the switcher (they
have none today), but a shared sub-tree address works for them when the root is visible to them.

### Management

- **Permission:** a new action `tree:manage_subtrees`, minimum role `manager`. Every endpoint
  denies by default.
- **API:** `GET /api/trees/[id]/subtrees` (the viewer's visible list, in `position` order);
  `POST` (name, slug, rootPersonId); `PATCH /api/trees/[id]/subtrees/[subtreeId]` (name, slug,
  root, position, with `version` for optimistic concurrency); `DELETE`. All writes go through the
  mutation runner and the change log, so a delete can be undone.
- **From the person:** "Make sub-tree from here" in the person page's actions and the drawer
  (manager and above). A dialog asks for a name, suggesting "<surname> line", and a slug made from
  it; on save it opens the new sub-tree.
- **Trees page:** under the current tree, its sub-trees with rename (and slug), change anchor (the
  person finder), move up/down, and delete.
- **The tree summary** carries `subtrees: { id, slug, name, rootPersonId }[]` and the active
  `subtree` (or null), so the layout and the switcher need no second request.

### Lifecycle

- **Root deleted:** person deletion is a hard delete with undo, so `root_person_id` has no foreign
  key: an undo brings the same id back and the sub-tree works again. Until then the sub-tree shows
  as "anchor missing" on the Trees page, and opening it shows the whole tree with a notice.
- **Root merged:** `PersonMergeService` repoints `root_person_id` from the merged-away person to the
  survivor, in the same mutation.
- **Tree deleted:** cascades.
- **GEDCOM:** sub-trees are not exported, as tasks are not; they are a view over the tree, not
  genealogy. Recorded in the ADR. No GEDCOM extension is planned: export sticks to the spec, and
  sub-trees are an app feature.

## Implementation phases

| Phase | What                                                                                                     | Depends on | Model  |
| ----- | -------------------------------------------------------------------------------------------------------- | ---------- | ------ |
| 1     | Migration, schema, repository, `inSubtree` fragment + plan test, service, API, summary fields, auth action, merge repoint | none       | Sonnet |
| 2     | `splitTreeSegment`, resolvers, host checks, canonical redirect, `TreeRef.subtree`, layout, switcher entries, chart focus order, banner | 1          | Sonnet |
| 3     | Management UI: "Make sub-tree from here" dialog, Trees page section                                      | 1          | Sonnet |
| 4     | Scoped reads: lists, search, finder, whole-tree graph, counts, "not in this sub-tree" note               | 2          | Sonnet |
| 5     | ADR-062 final text, architecture.md, backlog updates                                                     | 4          | Haiku  |

Phases 2 and 3 touch disjoint files and can run at the same time after phase 1 merges.
