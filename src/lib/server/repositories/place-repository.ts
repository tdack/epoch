/**
 * Place reads. A place is the text on a fact, grouped case-insensitively (ADR-018), so these are
 * aggregates over the tree's events; like the surname list they are linear in the tree and are
 * measured in query-plans.md. Visibility is built from the predicates of `visibility.ts`: a fact of a
 * private person is not counted or listed, and a partnership's fact needs every partner visible
 * (the S8 search leak, again).
 */

import { and, eq, isNotNull, ne, sql, type SQL } from 'drizzle-orm';
import type { DbClient } from '../db';
import { events, places } from '../db/schema';
import type { ViewerScope } from '../services/tree-access';
import { placeKey } from '../../shared/places';
import { andVisible, isVisibleOf } from './visibility';

type Scope = Pick<ViewerScope, 'isRestricted' | 'cutoff' | 'creatorId'>;

export interface PlaceFactRow {
	id: string;
	entityType: 'INDIVIDUAL' | 'FAMILY';
	entityId: string;
	type: string;
	dateRaw: string | null;
}

export interface PlaceAggregateRow {
	id: string;
	name: string;
	facts: number;
	people: number;
}

/** Escape LIKE's wildcards so a search for "100%" finds the text and not everything. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The facts of this tree that carry a place, visible to the viewer, as one relation. */
function visibleFacts(treeId: string, scope: Scope, match: SQL): SQL {
	const partnersVisible = scope.isRestricted
		? sql` and not exists (select 1 from union_partners up join individuals p on p.id = up.person_id where up.union_id = u.id and not ${isVisibleOf('p', scope)})`
		: sql``;
	return sql`
		select e.id as id, e.place as place, e.place_id as place_id, e.entity_type as entity_type, e.entity_id as entity_id, e.type as type, e.date_raw as date_raw, e.date_sort as date_sort
		from events e join individuals i on i.id = e.entity_id
		where e.tree_id = ${treeId} and e.entity_type = 'INDIVIDUAL' and e.place_id is not null${match}${andVisible('i', scope)}
		union all
		select e.id, e.place, e.place_id, e.entity_type, e.entity_id, e.type, e.date_raw, e.date_sort
		from events e join unions u on u.id = e.entity_id
		where e.tree_id = ${treeId} and e.entity_type = 'FAMILY' and e.place_id is not null${match}${partnersVisible}`;
}

/** The place record's id for the text an event row carries; null when it has none. */
export const placeIdOfEvent = sql`(select p.id from places p where p.tree_id = events.tree_id and p.name_key = lower(events.place))`;

/**
 * Statements that give every fact of the tree a place record for its text (ADR-019), set-based, for
 * the writers that insert events in bulk (import, test corpora). The change store does the same for
 * the facts one change writes. Run in order; safe to repeat, and in merge mode facts already pointing
 * at a record keep it because the key is the same. Batchable, unlike `db.run`.
 */
export function pointFactsAtPlaces(db: DbClient, treeId: string) {
	const insert = (
		db.insert(places) as unknown as { select: (query: SQL) => { onConflictDoNothing: () => never } }
	).select(
		sql`select lower(hex(randomblob(16))), tree_id, lower(place), unixepoch() from events
			where tree_id = ${treeId} and place is not null and place <> ''
			group by lower(place)`
	);
	return [
		insert.onConflictDoNothing(),
		db
			.update(events)
			.set({ placeId: placeIdOfEvent })
			.where(and(eq(events.treeId, treeId), isNotNull(events.place), ne(events.place, '')))
	] as const;
}

export class PlaceRepository {
	constructor(private db: DbClient) {}

	listSql(
		treeId: string,
		query: string,
		page: { offset: number; limit: number },
		scope: Scope
	): SQL {
		const match = query ? sql` and e.place like ${likePattern(query)} escape '\\'` : sql``;
		return sql`
			select f.place_id as id, min(f.place) as name, count(*) as facts, count(distinct case when f.entity_type = 'INDIVIDUAL' then f.entity_id end) as people
			from (${visibleFacts(treeId, scope, match)}) f
			group by f.place_id
			order by min(f.place) collate nocase, f.place_id
			limit ${page.limit + 1} offset ${page.offset}`;
	}

	async list(
		treeId: string,
		query: string,
		page: { offset: number; limit: number },
		scope: Scope
	): Promise<{ rows: PlaceAggregateRow[]; hasMore: boolean }> {
		const rows = await this.db.all<PlaceAggregateRow>(this.listSql(treeId, query, page, scope));
		return { rows: rows.slice(0, page.limit), hasMore: rows.length > page.limit };
	}

	factsSql(
		treeId: string,
		name: string,
		page: { offset: number; limit: number },
		scope: Scope
	): SQL {
		const match = sql` and e.place_id = (select id from places where tree_id = ${treeId} and name_key = ${placeKey(name)})`;
		return sql`select f.id as id, f.place as place, min(f.place) over () as name, f.place_id as placeId, f.entity_type as entityType, f.entity_id as entityId, f.type as type, f.date_raw as dateRaw
			from (${visibleFacts(treeId, scope, match)}) f
			order by f.date_sort is null, f.date_sort, f.id
			limit ${page.limit + 1} offset ${page.offset}`;
	}

	async facts(
		treeId: string,
		name: string,
		page: { offset: number; limit: number },
		scope: Scope
	): Promise<{ rows: Array<PlaceFactRow & { name: string; placeId: string }>; hasMore: boolean }> {
		const rows = await this.db.all<PlaceFactRow & { name: string; placeId: string }>(
			this.factsSql(treeId, name, page, scope)
		);
		return { rows: rows.slice(0, page.limit), hasMore: rows.length > page.limit };
	}
}
