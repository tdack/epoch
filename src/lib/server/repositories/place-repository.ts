/**
 * Place reads. A place is the text on a fact, grouped case-insensitively (ADR-018), so these are
 * aggregates over the tree's events; like the surname list they are linear in the tree and are
 * measured in query-plans.md. Visibility is built from the predicates of `visibility.ts`: a fact of a
 * private person is not counted or listed, and a partnership's fact needs every partner visible
 * (the S8 search leak, again).
 */

import { and, eq, inArray, isNotNull, ne, sql, type SQL } from 'drizzle-orm';
import type { DbClient } from '../db';
import { events, placeLocations, places } from '../db/schema';
import type { ViewerScope } from '../services/tree-access';
import { placeKey, type PlaceLocationDto } from '../../shared/places';
import { chunkIds } from './param-chunks';
import { andInLens, andUnionInLens } from './subtree-membership';
import { likePattern } from './like-pattern';
import { andVisible, isVisibleOf, literalList } from './visibility';

type Scope = Pick<ViewerScope, 'isRestricted' | 'cutoff' | 'creatorId'>;

export interface PlaceFactRow {
	id: string;
	entityType: 'INDIVIDUAL' | 'FAMILY';
	entityId: string;
	type: string;
	dateRaw: string | null;
}

export interface PlaceMapRow {
	id: string;
	name: string;
	latitude: number;
	longitude: number;
	facts: number;
	people: number;
}

/** A place with no location row at all; an ignored place has one, so it is not "unlocated". */
const hasNoLocation = sql` and not exists (select 1 from place_locations pl where pl.id = e.place_id)`;

export interface PlaceAggregateRow {
	id: string;
	name: string;
	facts: number;
	people: number;
}

/** Fact types that name where a person lived; a living person's are left off maps (ADR-078). */
const RESIDENCE_EVENT_TYPES = ['RESI', 'CENS'] as const;

/**
 * The facts of this tree that carry a place, visible to the viewer, as one relation. With
 * `isMapped`, a person's residence or census fact is also dropped unless the living rule shows the
 * person as dead or the person is marked public: the rule is the viewer-independent one, so an
 * owner's map leaves living people's homes off too.
 */
function visibleFacts(
	treeId: string,
	scope: Scope,
	match: SQL,
	lensRootId: string | null,
	isMapped = false
): SQL {
	const notLivingHome = isMapped
		? sql` and (e.type not in (${literalList(RESIDENCE_EVENT_TYPES)}) or ${isVisibleOf('i', { cutoff: scope.cutoff, creatorId: null })})`
		: sql``;
	const partnersVisible = scope.isRestricted
		? sql` and not exists (select 1 from union_partners up join individuals p on p.id = up.person_id where up.union_id = u.id and not ${isVisibleOf('p', scope)})`
		: sql``;
	return sql`
		select e.id as id, e.place as place, e.place_id as place_id, e.entity_type as entity_type, e.entity_id as entity_id, e.type as type, e.date_raw as date_raw, e.date_sort as date_sort
		from events e join individuals i on i.id = e.entity_id
		where e.tree_id = ${treeId} and e.entity_type = 'INDIVIDUAL' and e.place_id is not null${match}${andVisible('i', scope)}${notLivingHome}${andInLens('i', treeId, lensRootId)}
		union all
		select e.id, e.place, e.place_id, e.entity_type, e.entity_id, e.type, e.date_raw, e.date_sort
		from events e join unions u on u.id = e.entity_id
		where e.tree_id = ${treeId} and e.entity_type = 'FAMILY' and e.place_id is not null${match}${partnersVisible}${andUnionInLens('u', treeId, lensRootId)}`;
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
	// Drizzle's typed insert-select cannot take a raw SQL select.
	const insert = (
		db.insert(places) as unknown as {
			select: (query: SQL) => { onConflictDoNothing: () => never };
		}
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

/**
 * A statement that gives every place of the tree that has no location the first fact's coordinates
 * (ADR-078), set-based like `pointFactsAtPlaces` and to run after it. The parse is the SQL of
 * migration 0047, restricted to one tree; `parseGedcomCoordinate` is its reference and
 * place-locations.test.ts keeps them equal. A place that already has a location, of any status or
 * source, keeps it, so a merge-mode import never overwrites a manual pick.
 */
export function seedLocationsFromFacts(db: DbClient, treeId: string) {
	const insert = (
		db.insert(placeLocations) as unknown as {
			select: (query: SQL) => { onConflictDoNothing: () => never };
		}
	).select(
		sql`with raw as (
				select e.place_id as place_id, e.rowid as rid,
					upper(substr(trim(e.latitude), 1, 1)) as lc, trim(e.latitude) as lt,
					upper(substr(trim(e.longitude), 1, 1)) as gc, trim(e.longitude) as gt
				from events e
				where e.tree_id = ${treeId} and e.place_id is not null and e.latitude is not null and e.longitude is not null
			), split as (
				select place_id, rid,
					case when lc in ('N', 'S', '-', '+') then substr(lt, 2) else lt end as lr,
					case when lc in ('S', '-') then -1.0 else 1.0 end as ls,
					case when gc in ('E', 'W', '-', '+') then substr(gt, 2) else gt end as gr,
					case when gc in ('W', '-') then -1.0 else 1.0 end as gs
				from raw
			), parsed as (
				select place_id, rid, ls * cast(lr as real) as lat, gs * cast(gr as real) as lng
				from split
				where lr <> '' and lr not glob '*[^0-9.]*' and lr glob '*[0-9]*' and length(lr) - length(replace(lr, '.', '')) <= 1
					and gr <> '' and gr not glob '*[^0-9.]*' and gr glob '*[0-9]*' and length(gr) - length(replace(gr, '.', '')) <= 1
			), in_range as (
				select * from parsed where lat between -90 and 90 and lng between -180 and 180
			)
			select p.id, p.tree_id, v.lat, v.lng, 'confirmed', 'gedcom', null, null, null, 1, unixepoch(), unixepoch()
			from places p join in_range v on v.place_id = p.id
			where v.rid = (select min(w.rid) from in_range w where w.place_id = p.id)`
	);
	return insert.onConflictDoNothing();
}

export class PlaceRepository {
	constructor(private db: DbClient) {}

	/** The locations of these place records, which the caller has already limited to places it may see. */
	async locationsOf(treeId: string, placeIds: string[]): Promise<Map<string, PlaceLocationDto>> {
		const found = new Map<string, PlaceLocationDto>();
		for (const chunk of chunkIds(placeIds, 80)) {
			const rows = await this.db
				.select()
				.from(placeLocations)
				.where(and(eq(placeLocations.treeId, treeId), inArray(placeLocations.id, chunk)));
			for (const r of rows)
				found.set(r.id, {
					latitude: r.latitude,
					longitude: r.longitude,
					status: r.status,
					source: r.source,
					version: r.version
				});
		}
		return found;
	}

	listSql(
		treeId: string,
		query: string,
		page: { offset: number; limit: number },
		scope: Scope,
		lensRootId: string | null = null,
		isUnlocated = false
	): SQL {
		const match = sql`${query ? sql` and e.place like ${likePattern(query)} escape '\\'` : sql``}${isUnlocated ? hasNoLocation : sql``}`;
		return sql`
			select f.place_id as id, min(f.place) as name, count(*) as facts, count(distinct case when f.entity_type = 'INDIVIDUAL' then f.entity_id end) as people
			from (${visibleFacts(treeId, scope, match, lensRootId)}) f
			group by f.place_id
			order by min(f.place) collate nocase, f.place_id
			limit ${page.limit + 1} offset ${page.offset}`;
	}

	async list(
		treeId: string,
		query: string,
		page: { offset: number; limit: number },
		scope: Scope,
		lensRootId: string | null = null,
		isUnlocated = false
	): Promise<{ rows: PlaceAggregateRow[]; hasMore: boolean }> {
		const rows = await this.db.all<PlaceAggregateRow>(
			this.listSql(treeId, query, page, scope, lensRootId, isUnlocated)
		);
		return { rows: rows.slice(0, page.limit), hasMore: rows.length > page.limit };
	}

	/**
	 * Every place with a confirmed location, counted over the facts the viewer may see and the map
	 * may show. Not paged: a map needs all its markers. A place with no such fact is absent.
	 */
	async mapRows(
		treeId: string,
		scope: Scope,
		lensRootId: string | null = null
	): Promise<PlaceMapRow[]> {
		return this.db.all<PlaceMapRow>(sql`
			select f.place_id as id, min(f.place) as name, pl.latitude as latitude, pl.longitude as longitude, count(*) as facts, count(distinct case when f.entity_type = 'INDIVIDUAL' then f.entity_id end) as people
			from (${visibleFacts(treeId, scope, sql``, lensRootId, true)}) f
			join place_locations pl on pl.id = f.place_id
			where pl.tree_id = ${treeId} and pl.status = 'confirmed' and pl.latitude is not null and pl.longitude is not null
			group by f.place_id
			order by min(f.place) collate nocase, f.place_id`);
	}

	/** How many places the viewer may see have no location row yet. */
	async unlocatedCount(
		treeId: string,
		scope: Scope,
		lensRootId: string | null = null
	): Promise<number> {
		const [row] = await this.db.all<{ n: number }>(
			sql`select count(distinct f.place_id) as n from (${visibleFacts(treeId, scope, hasNoLocation, lensRootId)}) f`
		);
		return row?.n ?? 0;
	}

	factsSql(
		treeId: string,
		name: string,
		page: { offset: number; limit: number },
		scope: Scope,
		lensRootId: string | null = null
	): SQL {
		const match = sql` and e.place_id = (select id from places where tree_id = ${treeId} and name_key = ${placeKey(name)})`;
		return sql`select f.id as id, f.place as place, min(f.place) over () as name, f.place_id as placeId, f.entity_type as entityType, f.entity_id as entityId, f.type as type, f.date_raw as dateRaw
			from (${visibleFacts(treeId, scope, match, lensRootId)}) f
			order by f.date_sort is null, f.date_sort, f.id
			limit ${page.limit + 1} offset ${page.offset}`;
	}

	async facts(
		treeId: string,
		name: string,
		page: { offset: number; limit: number },
		scope: Scope,
		lensRootId: string | null = null
	): Promise<{ rows: Array<PlaceFactRow & { name: string; placeId: string }>; hasMore: boolean }> {
		const rows = await this.db.all<PlaceFactRow & { name: string; placeId: string }>(
			this.factsSql(treeId, name, page, scope, lensRootId)
		);
		return { rows: rows.slice(0, page.limit), hasMore: rows.length > page.limit };
	}
}
