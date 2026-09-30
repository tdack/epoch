# Query plans for the bounded graph

Recorded 2026-09-30 by `src/lib/server/repositories/graph-window-plans.test.ts` against a generated
tree of about 5,300 people, 2,600 partnerships, 5,600 parent-child links and 9,600 events
(`src/lib/server/testing/corpus.ts`). Each lookup is given three ids, so "returned" is a handful.
The numbers are D1's own `rows_read`, from the local D1 the tests run against.

Regenerate this table with:

```sh
WRITE_QUERY_PLANS=plans.txt npx vitest run --project server src/lib/server/repositories/graph-window-plans.test.ts
```

## What the measurement found

The first version of these queries filtered `tree_id = ?` next to the id list. SQLite picked the
`(tree_id)` index to drive the query, because without statistics it cannot tell that the id list is
more selective. `EXPLAIN QUERY PLAN` calls that a `SEARCH … USING INDEX`, not a `SCAN`, so a check
for full scans passes it, but it walks every row of the tree and discards nearly all of them:

| Query (three ids) | Rows returned | Rows read with `tree_id = ?` | Rows read now |
|---|---|---|---|
| individuals by id | 3 | 5,324 | 6 |
| partner rows of people | 4 | 10,400 | 14 |
| links by child | 2 | 5,591 | 6 |
| links by parent | 6 | 5,591 | 11 |
| links by union | 6 | 5,591 | 12 |
| events (person, birth and death) | 3 | 9,591 | 9 |
| events (union) | 3 | 9,591 | 9 |

D1 bills and reports rows read, so this would have made every step of every window cost the size of
the tree. The fix is in the query, not the schema: the tree scope is written `+tree_id = ?` (a unary
plus makes it a filter that cannot drive the index), so the id, child, parent and entity indexes lead
and the tree check still applies to every row returned. The plan test asserts rows read stays within
a small multiple of rows returned, and was checked to fail on the old form.

**No index was added.** Every lookup is served by an index that already exists. A compound
`(tree_id, child_id)` index would also work, but it would cost every write and buy nothing the query
change does not.

## Plans and rows read

### individuals by id

- `SEARCH individuals USING INDEX sqlite_autoindex_individuals_1 (id=?)`

Rows returned 3, rows read 6.

### unions by id

- `SEARCH unions USING INDEX sqlite_autoindex_unions_1 (id=?)`

Rows returned 3, rows read 6.

### partner rows of people

- `SEARCH union_partners USING INDEX idx_union_partner_person (person_id=?)`
- `SEARCH unions USING INDEX sqlite_autoindex_unions_1 (id=?)`

Rows returned 4, rows read 14.

### partner rows of unions

- `SEARCH unions USING INDEX sqlite_autoindex_unions_1 (id=?)`
- `SEARCH union_partners USING INDEX idx_uq_union_person (union_id=?)`

Rows returned 6, rows read 15.

### links by child

- `SEARCH parent_child USING INDEX idx_parent_child_child (child_id=?)`

Rows returned 2, rows read 6.

### links by parent

- `SEARCH parent_child USING INDEX idx_parent_child_parent (parent_id=?)`

Rows returned 6, rows read 11.

### links by union

- `SEARCH parent_child USING INDEX idx_parent_child_union (union_id=?)`

Rows returned 6, rows read 12.

### person events (birth, death)

- `SEARCH events USING INDEX idx_event_entity (entity_type=? AND entity_id=?)`

Rows returned 3, rows read 9.

### union events

- `SEARCH events USING INDEX idx_event_entity (entity_type=? AND entity_id=?)`

Rows returned 3, rows read 9.

### names of people

- `SEARCH person_names USING INDEX idx_person_name_person (person_id=?)`

Rows returned 0, rows read 3. (The generated tree has no stored name rows; the plan is what matters.)

### media of people

- `SEARCH media_items USING INDEX idx_media_entity (entity_id=?)`

Rows returned 0, rows read 3.

### changes touching records (the person page's history)

- `SEARCH change_log_records USING INDEX idx_change_log_records_entity (entity_id=?)`
- `SEARCH change_log USING INDEX change_log_id_unique (id=?)`
- `USE TEMP B-TREE FOR ORDER BY`

Rows returned 0, rows read 4. The sort is over the changes that wrote these records, not the log.

### first person

- `SEARCH individuals USING INDEX idx_ind_tree (tree_id=?)`

Rows returned 1, rows read 1.

### count people

- `SEARCH individuals USING COVERING INDEX idx_ind_tree (tree_id=?)`

Rows returned 1, rows read 5324.

### count unions

- `SEARCH unions USING COVERING INDEX idx_union_tree (tree_id=?)`

Rows returned 1, rows read 2599.

## Known cost: counts

The tree summary counts people and partnerships with `count(*)`. SQLite walks a covering index to
count, so it reads one index entry per row (5,324 and 2,599 above). That is linear in the tree and
is the only part of a page load that is. It is acceptable at the sizes Epoch targets; if trees grow
far past that, keep counters on the `trees` row instead of counting (Phase 8, performance).

## Writes still read the whole tree

Every mutation plans against a full `TreeRows` snapshot (`ChangeStore.loadRows`). That is outside
this slice, which bounds reads. It is the next place a large tree will hurt.

## Name search (S6)

`RelationshipRepository.searchPeople` matches every stored name. The other filter is a `LIKE`, which
cannot use an index, so the `+tree_id` trick above is wrong here: with it `EXPLAIN QUERY PLAN`
reads `SCAN n` (every name of every tree) then `SEARCH i USING INDEX sqlite_autoindex_individuals_1`;
with a plain `tree_id = ?` it reads `SEARCH i USING INDEX idx_ind_tree` then
`SEARCH n USING INDEX idx_person_name_person`, so the work is bounded by one tree. The plain form is
used. Search is still linear in the tree's people, which is fine for this phase's corpora.

## Search (S7)

Recorded 2026-10-01 by `src/lib/server/repositories/search-plans.test.ts`. It inserts **two** trees
into one database (5,324 people and 419 people, both with stored names, XREFs and places from
`insertCorpus(..., { shouldNameThePeople: true })`) and runs each query against both. The small tree
is the witness: on one tree a query that scans every tree and one that scans a single tree read the
same rows, but a query that read the big tree to answer the small one would read far more than the
small tree holds. The test asserts rows read stays within `6 × (people + names + events)` of the
tree asked about, and that no plan line is a scan of a table (a CTE's own scan is not one).

Regenerate with `WRITE_QUERY_PLANS=plans.txt npx vitest run --project server src/lib/server/repositories/search-plans.test.ts`.

### What the measurement found

- **Baseline (S6 `searchPeople`, tree of 9,809 people):** the display-name half read 9,810 rows and
  the stored-name half read 30,930. Linear in the tree, correctly bounded to it.
- **The first version of the place and date filter read 951,241 rows to answer a 419-person tree**
  and 12.8 million for the big one. The partnership branch was written as a join
  `union_partners up join events e on e.entity_type = 'FAMILY' and e.entity_id = up.union_id`, and
  SQLite drove it from `events` by `(entity_type = ?)` alone: every family event of every tree, for
  every person. `EXPLAIN QUERY PLAN` called it `SEARCH e USING INDEX idx_event_entity (entity_type=?)`,
  not a scan. The fix is structural: `exists (select 1 from union_partners up where up.person_id =
  i.id and exists (select 1 from events e where e.entity_type = 'FAMILY' and e.entity_id =
  up.union_id and …))`, so the partner index leads and the event lookup uses both index columns.
  Now 2,784 rows for the small tree.
- **The XREF lookup read 419 rows** (the whole small tree) because SQLite chose `idx_ind_tree` over
  `idx_ind_xref` for `tree_id = ? and xref_id in (…)`. `indexed by idx_ind_xref` makes it 5 rows.
- **No index was added.** Every name, place and date search is linear in one tree's people, names and
  events (about four to eight rows read per person), which is the same order as the S6 search it
  replaces and acceptable at the sizes this phase targets. A `LIKE '%…%'` cannot use an index, and
  an index on `events.place` or on the date bounds would not help the partnership branch or the
  substring match.

### Plans and rows read

| Query | Small tree (419 people) returned / read | Big tree (5,324 people) returned / read |
|---|---|---|
| name, two words | 6 / 1,768 | 2 / 22,079 |
| name, one letter | 26 / 3,035 | 26 / 40,325 |
| surname with a stored married name | 5 / 1,758 | 26 / 22,198 |
| place | 26 / 2,784 | 26 / 35,560 |
| year range | 26 / 2,124 | 26 / 35,153 |
| place and year range | 21 / 2,916 | 26 / 38,033 |
| name, place and year range | 0 / 1,869 | 2 / 23,854 |
| XREF | 1 / 5 | |

Name queries plan as `SEARCH i USING INDEX idx_ind_tree (tree_id=?)` (the display-name candidates),
`UNION ALL`, `SEARCH i USING INDEX idx_ind_tree` then `SEARCH n USING INDEX idx_person_name_person
(person_id=?)` (the stored names), a `GROUP BY` over the candidates for each person's best name, and
a temp B-tree for the order. Place and date queries add `CORRELATED SCALAR SUBQUERY` lines for
`SEARCH e USING INDEX idx_event_entity (entity_type=? AND entity_id=?)` and, for partnership facts,
`SEARCH up USING INDEX idx_union_partner_person (person_id=?)` with an `EXISTS` event search.

### Known cost

Search ranks every candidate in the tree before `LIMIT`, because ranking after a capped fetch would
drop the exact match of a short query ("a"). That is linear in the tree per keystroke (debounced in
the UI). Past tens of thousands of people it needs an indexed, normalised name column; that is a
Phase 8 decision with numbers, not a guess now.
