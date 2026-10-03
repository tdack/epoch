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

## Lists (S7)

Recorded by `src/lib/server/repositories/list-plans.test.ts` on the same two-tree setup as search
(small tree 419 people and 484 stored names, about 900 rows; big tree 5,324 people, about 11,400
rows). Regenerate with `WRITE_QUERY_PLANS=plans.txt npx vitest run --project server src/lib/server/repositories/list-plans.test.ts`.

### Indexes decided with numbers

| Query | Without a new index | With it |
|---|---|---|
| individuals by surname, any page | 10,648 rows read (`USE TEMP B-TREE FOR ORDER BY`: the page sorts the whole tree, at every offset) | 51 at offset 0; `offset + 51` deeper |
| individuals by given name | 10,648, same reason | 51 |

Migration 0010 (expand-only, two `CREATE INDEX`es, no table rebuild) adds
`idx_ind_tree_surname (tree_id, surname COLLATE NOCASE, given_name COLLATE NOCASE, id)` and
`idx_ind_tree_given (tree_id, given_name COLLATE NOCASE, surname COLLATE NOCASE, id)`. `id` ends each
so the order is total (stable pages) and the index covers the page query; `COLLATE NOCASE` because a
list sorted "Brown, brown, Browns" by byte order is wrong and an index only serves an `ORDER BY` with
the same collation. Each costs one extra index write per person written.

**Rejected:** an index on `person_names (surname COLLATE NOCASE, person_id)` for the surname filter.
It made the filter fast, but `person_names` has no `tree_id`, so it reads every tree's rows for a
common surname; the filter instead joins through `individuals` to keep to one tree.

### Plans and rows read

| Query | Small tree returned / read | Big tree returned / read |
|---|---|---|
| individuals by surname, first page | 51 / 51 | 51 / 51 |
| individuals by given name, first page | 51 / 51 | 51 / 51 |
| individuals by surname, page 100 (offset 4,950) | 0 / 420 | 51 / 5,001 |
| individuals of one surname (filter) | 19 / 1,743 | 51 / 17,194 |
| surname list | 51 / 3,119 | 51 / 34,898 |
| partnership list, first page | 51 / 51 | 51 / 51 |

First pages are `SEARCH i USING COVERING INDEX idx_ind_tree_surname (tree_id=?)` with no sort step
(the test asserts no `TEMP B-TREE FOR ORDER BY`); the partnership list reads the tree index in rowid
order. Then the person records for the page come from the bounded id reads.

### Known costs

- **Offset pagination is linear in the offset.** A deep page reads `offset + 51` index entries (5,001
  for offset 4,950), never more than the tree. A keyset cursor on `(surname, given_name, id)` would
  read 51, but `NULL` surnames compare false and the cursor would need encoding; the offset form is
  simple and bounded, so it stays until a tree is large enough to notice.
- **The surname filter and the surname list are linear in one tree** (3.2x and 6.5x the tree's
  people read), because the distinct surnames and their per-person counts have to be computed across
  every stored name. No list loads the tree or returns more than a page; the aggregate is the price
  of "every stored name". Denormalised surname counters are Phase 8 if a tree needs them.
- Unsurnamed people sort first (`NULL` first in the index), not last, because an expression in the
  `ORDER BY` would lose the index.

## Visibility (S8, ADR-015)

For a contributor or a viewer every read below also carries the visibility predicate
(`repositories/visibility.ts`): two correlated lookups on `idx_event_entity` per person examined,
about 4.5 index rows each. Owners, managers and editors run the unfiltered query, whose numbers are
the S7 ones above. The predicate never reads another tree: the lookup is by the person's own id.
The plan tests measure both viewers on the same two trees (small: 419 people, 903 with names; big:
5,324 people, 11,425) and fail on a table scan or on a read beyond the bounds in the tests.

| Read | Everyone, small / big | Restricted, small / big |
|---|---|---|
| People list, first page (surname order) | 51 / 51 | 217 / 259 |
| People list, first page (given-name order) | 51 / 51 | 209 / 253 |
| People list, page 100 | 419 / 5,001 | 1,793 / 23,285 |
| One surname's people | 1,740 / 17,196 | 1,808 / 17,409 |
| Surname list, first page | 3,116 / 34,901 | 5,864 / 67,569 |
| Partnership list, first page | 51 / 51 | 650 / 648 |
| Search: name, two words | 1,765 / 22,082 | 1,785 / 22,090 |
| Search: one letter | 3,032 / 40,328 | 4,046 / 54,676 |
| Search: place | 2,781 / 35,563 | 7,191 / 86,963 |
| Search: year range | 2,122 / 35,154 | 5,163 / 82,943 |
| Search: place and year range | 2,913 / 38,036 | 7,383 / 91,531 |
| XREF lookup | 5 | 7 |

- **A name search pays almost nothing** because the predicate is applied after ranking, to the people
  the name filter already kept. A place or year search pays about 2.3 times: a restricted viewer may
  match a partnership's marriage only when every partner is visible, so each candidate's partnerships
  look up their partners' events too (a search for a private couple's wedding year must not find the
  visible partner; `privacy-reads.test.ts`). Still one tree's worth, never another's.
- **The surname list pays most** (about 12 rows per person on the big tree, against 6.5 before),
  because it aggregates over every person. If a tree outgrows that, the stored-column alternative in
  ADR-015 is the next step, and only the predicate changes.
- **The partnership list's first page** costs 650 rows instead of 51: each union row looks up both
  partners' events.
- **A contributor's predicate has a third term** (`created_by is <them>`, their own people stay
  visible, ADR-015) and is measured as a second restricted shape beside the viewer's. The numbers
  above are the same for both, to the row, and `list-plans.test.ts` and `search-plans.test.ts` hold
  the answers of the two identical on trees where nobody is a creator. That check exists because the
  first form of the term, `created_by = <them>`, was null for a person with no author and turned
  "private" into "unknown" under `not`: it read fewer rows only because it let a private partner's
  partnership through, which `privacy-reads.test.ts` now covers for a contributor too.

## Kin window (S10): relationship, pedigree and descendants

`loadKinWindow` (`services/kin-window.ts`) follows parent links outwards one generation per round,
then loads people, birth and death events, names and partnerships for the people it found. It reads
through the same lookups as the focus window (`linksBy`, `individualsIn`, `eventsOf`, `namesOf`,
`partnerRowsOf*`), each already plan-tested as index-proportional, and stops at a generation limit
and at 3,000 people. `kin-plans.test.ts` runs it against the big tree (5,324 people, nine
generations) with a counting D1 and holds the cost to 40 rows per person loaded.

| Read | People loaded | Statements | Rows read |
|---|---|---|---|
| Ancestors of one person, 20 generations (relationship) | 18 | 15 | 161 |
| Ancestors of two people and their partners (relationship) | 29 | 15 | 276 |
| Pedigree, 8 generations | 15 | 11 | 132 |
| Descendants of a founder, 8 generations, with partners | 42 | 14 | 552 |

About 9 to 13 rows per person, a handful of batches, and no read of another tree. A read that wants
only one direction does not look in the other, which is why they are one statement lighter than
when the window checked both. The restricted
viewer pays nothing extra here: privacy is applied in memory to the rows loaded, as for the record
pages, not in the queries. A pedigree of eight generations can hold 255 people and a descendant
chart of a prolific founder more; the 3,000 ceiling bounds the worst case and the chart then says
more lies beyond.

## Places (S10, ADR-018; records S11, ADR-019)

The new index `idx_event_place` did not move any earlier read: the list and search tables above were
re-measured with it in place and are unchanged (it did change the unspecified order of the two
whole-tree event loads that had no `ORDER BY`, now stated as insertion order).

A place is the text on a fact, grouped without regard to ASCII case, so the place list is an
aggregate over the tree's events (linear in the tree, like the surname list) and a place page is a
lookup on `idx_event_place (tree_id, place collate nocase)` (migration 0015). Visibility comes from
`andVisible` for a person's fact and an all-partners-visible test for a partnership's, so a place
only private people or a couple with a private partner give is absent. The viewer and the contributor
(whose predicate has the creator term) are measured separately and compared; their answers are
identical. Small tree: 769 events; big: 9,591 (`place-plans.test.ts`).

| Read | Everyone, small / big | Restricted, small / big |
|---|---|---|
| Place list, first page | 2,788 / 35,038 | 6,482 / 79,837 |
| Place list, filtered by a substring | 1,697 / 20,839 | 2,116 / 25,544 |
| Facts at one place, first page (the commonest place) | 473 / 4,973 | 892 / 9,422 |

Since S11 a place is its record (`events.place_id`): the list groups by it and a place page reads `idx_event_place_id` after one lookup of the record by `idx_place_key`, which is why the facts read cost about 1.5 times what it did. The list is unchanged in cost.

The facts read is in proportion to the facts at that place, not the tree: the page orders them by
date, so every fact at the place is read to return a page. The restricted list pays about 2.3 times
for looking up each fact's person; the plan test bounds it at 12 rows per event, and the corpus has
only ten distinct places, so a real tree's list has more rows and the same cost.

## Data-quality report (S13, ADR-021)

The report is not a paged read: it loads every row of the tree once (`ChangeStore.loadRows`, seven
indexed reads by `tree_id`, the same as an export or a mutation) and runs the rules in memory, so its
cost is linear in the tree and independent of the number of findings. The only other query is the
tree's dismissals, one indexed read on `idx_quality_dismissal_key (tree_id, finding_key)`. Dismissing
runs the report's checks first (to refuse a key that is not a current finding) and then one upsert.
The longest rule is the loop check, an iterative Tarjan over the parent links, linear in them and
tested on a 20,000-link chain.

## Person merge (S14, ADR-022)

A review, a preview and a merge each load the tree's rows once (`ChangeStore.loadRows`), as every
command does, and plan in memory; nothing new is read per record. The write is one batch of at most
300 row operations (`MAX_PERSON_MERGE_OPS`), plus the place-record statements for moved facts, and
the mark copy is one read and chunked inserts on `idx_uq_person_mark`. The possible-duplicates rule
groups the tree's people by name in one pass and compares birth spans only inside a group.

## Evidence (ADR-028)

A person's citations are four bounded reads in one batch (the person, their names, their facts and
the links where they are the child), each led by `idx_citation_subject (subject_kind, subject_id,
sort_order)` and joined by primary key; sources for their labels are one `id IN (...)` read. A source's
citations are paged by `idx_citation_source`. The sources list pages on `idx_source_title`. For a
viewer who sees everyone these are the whole cost. For a restricted viewer the list and counts also
evaluate `with vp` (the visible people of the tree, as the tree summary counts do) once per request.
These were not run against the 5,300-person corpus; the plan test there does not yet cover them.
