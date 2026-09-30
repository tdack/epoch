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
