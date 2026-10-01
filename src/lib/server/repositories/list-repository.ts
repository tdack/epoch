/**
 * Page queries for the lists. Each returns ids (or aggregate rows) for one page and never loads
 * the tree; the service fills in the records for those ids with the bounded reads.
 *
 * Offset pagination over a total order (name, then id), with `limit + 1` fetched so a page knows
 * whether there is a next one. Plans and rows read are in query-plans.md.
 */

import { sql, type SQL } from 'drizzle-orm';
import type { DbClient } from '../db';
import { INDIVIDUAL_SORTS, type IndividualSort } from '../../shared/lists';

export interface PageRequest {
	offset: number;
	limit: number;
}

export interface SurnameCount {
	surname: string;
	people: number;
}

/** The order the individuals list pages in; each matches an index so a page does not sort the tree. */
const ORDER: Record<IndividualSort, SQL> = {
	[INDIVIDUAL_SORTS.SURNAME]: sql`i.surname collate nocase, i.given_name collate nocase, i.id`,
	[INDIVIDUAL_SORTS.GIVEN]: sql`i.given_name collate nocase, i.surname collate nocase, i.id`
};

export class ListRepository {
	constructor(private db: DbClient) {}

	individualsSql(treeId: string, sort: IndividualSort, surname: string, page: PageRequest): SQL {
		// The surname filter is the surname list's own rule (see `surnamesSql`): the display surname,
		// or any stored name's. The stored-name half joins through individuals to bound it to this
		// tree; person_names has no tree_id, and an index on its surname would read other trees' rows.
		const filter = surname
			? sql` and (i.surname = ${surname} collate nocase or i.id in (select n.person_id from person_names n join individuals i2 on i2.id = n.person_id where i2.tree_id = ${treeId} and n.surname = ${surname} collate nocase))`
			: sql``;
		return sql`select i.id as id from individuals i where i.tree_id = ${treeId}${filter} order by ${ORDER[sort]} limit ${page.limit + 1} offset ${page.offset}`;
	}

	async individualIds(treeId: string, sort: IndividualSort, surname: string, page: PageRequest): Promise<{ ids: string[]; hasMore: boolean }> {
		const rows = await this.db.all<{ id: string }>(this.individualsSql(treeId, sort, surname, page));
		return { ids: rows.slice(0, page.limit).map((r) => r.id), hasMore: rows.length > page.limit };
	}

	unionsSql(treeId: string, page: PageRequest): SQL {
		// Creation order: the `(tree_id)` index is in rowid order, so a page reads offset + limit entries.
		return sql`select id from unions where tree_id = ${treeId} order by rowid limit ${page.limit + 1} offset ${page.offset}`;
	}

	async unionIds(treeId: string, page: PageRequest): Promise<{ ids: string[]; hasMore: boolean }> {
		const rows = await this.db.all<{ id: string }>(this.unionsSql(treeId, page));
		return { ids: rows.slice(0, page.limit).map((r) => r.id), hasMore: rows.length > page.limit };
	}

	/**
	 * Distinct surnames across every stored name and each person's display name, with how many
	 * people carry each. A person counts once per surname however many of their names share it, and
	 * two casings of a surname are one (`collate nocase`, the same rule the list filter uses, so a
	 * count here equals the rows of the filtered individuals list).
	 */
	surnamesSql(treeId: string, page: PageRequest): SQL {
		return sql`
			with pairs as (
				select pid, min(s) as shown from (
					select i.id as pid, i.surname as s from individuals i where i.tree_id = ${treeId} and i.surname <> ''
					union all
					select n.person_id, n.surname from person_names n join individuals i on i.id = n.person_id where i.tree_id = ${treeId} and n.surname <> ''
				) group by pid, s collate nocase
			)
			select min(shown) as surname, count(*) as people from pairs
			group by shown collate nocase order by shown collate nocase limit ${page.limit + 1} offset ${page.offset}`;
	}

	async surnames(treeId: string, page: PageRequest): Promise<{ rows: SurnameCount[]; hasMore: boolean }> {
		const rows = await this.db.all<SurnameCount>(this.surnamesSql(treeId, page));
		return { rows: rows.slice(0, page.limit), hasMore: rows.length > page.limit };
	}
}
