/**
 * Read queries for the bounded graph: each one fetches the rows for a handful of ids, never a
 * whole tree. Rows come back as change-log images tagged with their `rowid`, so the caller can
 * restore the insertion order `ChangeStore.loadRows` uses and a window draws exactly what the whole
 * tree would.
 *
 * Every query is scoped to the tree (`union_partners` has no `tree_id` of its own, so it joins
 * through `unions`), and every id list is chunked: D1 allows 100 bound parameters per statement.
 *
 * Reads are built, not run: each method returns a `Read` and `run` sends any number of them in one
 * `db.batch`, which is one round trip to D1. The loader asks for several reads at a time, so a
 * window costs a few round trips per generation rather than a dozen.
 */

import { and, asc, count, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { DbClient } from '../db';
import { events, individuals, mediaItems, parentChild, unionPartners, unions } from '../db/schema';
import type {
	EventRow,
	IndividualRow,
	ParentChildRow,
	UnionPartnerRow,
	UnionRow
} from '../domain/change-log';
import { toImage } from './change-store';

/** Ids per `IN (...)`: 80 leaves room under D1's 100-parameter cap for the tree id and filters. */
export const IDS_PER_QUERY = 80;

export interface Ranked<T> {
	/** SQLite `rowid`: the table's insertion order. */
	rid: number;
	row: T;
}

/** Statements per `db.batch`; keeps one request comfortably small however wide a generation is. */
const STATEMENTS_PER_BATCH = 40;

/** A read that has been built but not sent, with how to turn its result rows into what the caller wants. */
export interface Read<T> {
	queries: BatchItem<'sqlite'>[];
	finish: (results: unknown[][]) => T;
}

type Results<Reads extends readonly Read<unknown>[]> = { [K in keyof Reads]: Reads[K] extends Read<infer T> ? T : never };

export interface TreeCounts {
	people: number;
	unions: number;
	links: number;
	events: number;
	media: number;
}

function chunked<T>(items: readonly T[]): T[][] {
	const unique = [...new Set(items)];
	const chunks: T[][] = [];
	for (let i = 0; i < unique.length; i += IDS_PER_QUERY) chunks.push(unique.slice(i, i + IDS_PER_QUERY));
	return chunks;
}

function ranked<T>(table: SQLiteTable, rows: Array<Record<string, unknown> & { rid: number }>): Array<Ranked<T>> {
	return rows.map(({ rid, ...row }) => ({ rid, row: toImage(table, row) as T }));
}

export class GraphWindowRepository {
	constructor(private db: DbClient) {}

	/** Send several reads in as few round trips as possible and hand back each one's result. */
	async run<const Reads extends readonly Read<unknown>[]>(...reads: Reads): Promise<Results<Reads>> {
		const statements = reads.flatMap((r) => r.queries);
		const results: unknown[][] = [];
		for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) {
			const batch = statements.slice(i, i + STATEMENTS_PER_BATCH) as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];
			results.push(...((await this.db.batch(batch)) as unknown[][]));
		}
		let offset = 0;
		return reads.map((r) => {
			const slice = results.slice(offset, offset + r.queries.length);
			offset += r.queries.length;
			return r.finish(slice);
		}) as unknown as Results<Reads>;
	}

	/** One query per chunk of ids; results are flattened and ranked. */
	private readIn<T, Id>(
		table: SQLiteTable,
		ids: readonly Id[],
		build: (chunk: Id[]) => BatchItem<'sqlite'>
	): Read<Array<Ranked<T>>> {
		return {
			queries: chunked(ids).map(build),
			finish: (results) => ranked<T>(table, results.flat() as Array<Record<string, unknown> & { rid: number }>)
		};
	}

	individualsIn(treeId: string, ids: readonly string[]): Read<Array<Ranked<IndividualRow>>> {
		return this.readIn(individuals, ids, (chunk) =>
			this.db
				.select({ ...getTableColumns(individuals), rid: sql<number>`${individuals}.rowid` })
				.from(individuals)
				.where(and(eq(individuals.treeId, treeId), inArray(individuals.id, chunk)))
		);
	}

	unionsIn(treeId: string, ids: readonly string[]): Read<Array<Ranked<UnionRow>>> {
		return this.readIn(unions, ids, (chunk) =>
			this.db
				.select({ ...getTableColumns(unions), rid: sql<number>`${unions}.rowid` })
				.from(unions)
				.where(and(eq(unions.treeId, treeId), inArray(unions.id, chunk)))
		);
	}

	/** Every partnership row of these people: which unions each is a partner of. */
	partnerRowsOfPersons(treeId: string, personIds: readonly string[]): Read<Array<Ranked<UnionPartnerRow>>> {
		return this.readIn(unionPartners, personIds, (chunk) =>
			this.db
				.select({ ...getTableColumns(unionPartners), rid: sql<number>`${unionPartners}.rowid` })
				.from(unionPartners)
				.innerJoin(unions, eq(unionPartners.unionId, unions.id))
				.where(and(eq(unions.treeId, treeId), inArray(unionPartners.personId, chunk)))
		);
	}

	/** Every partner row of these unions, so a union is never drawn with a partner missing. */
	partnerRowsOfUnions(treeId: string, unionIds: readonly string[]): Read<Array<Ranked<UnionPartnerRow>>> {
		return this.readIn(unionPartners, unionIds, (chunk) =>
			this.db
				.select({ ...getTableColumns(unionPartners), rid: sql<number>`${unionPartners}.rowid` })
				.from(unionPartners)
				.innerJoin(unions, eq(unionPartners.unionId, unions.id))
				.where(and(eq(unions.treeId, treeId), inArray(unionPartners.unionId, chunk)))
		);
	}

	/** Parent-child links by the child, the parent or the union they sit in. */
	linksBy(treeId: string, by: 'child' | 'parent' | 'union', ids: readonly string[]): Read<Array<Ranked<ParentChildRow>>> {
		const column = by === 'child' ? parentChild.childId : by === 'parent' ? parentChild.parentId : parentChild.unionId;
		return this.readIn(parentChild, ids, (chunk) =>
			this.db
				.select({ ...getTableColumns(parentChild), rid: sql<number>`${parentChild}.rowid` })
				.from(parentChild)
				.where(and(eq(parentChild.treeId, treeId), inArray(column, chunk)))
		);
	}

	/**
	 * Events of one kind of entity. `types` narrows to those event types; the entity type is always
	 * in the predicate so the `(entity_type, entity_id)` index is usable.
	 */
	eventsOf(
		treeId: string,
		entityType: 'INDIVIDUAL' | 'FAMILY',
		entityIds: readonly string[],
		types?: readonly string[]
	): Read<Array<Ranked<EventRow>>> {
		return this.readIn(events, entityIds, (chunk) =>
			this.db
				.select({ ...getTableColumns(events), rid: sql<number>`${events}.rowid` })
				.from(events)
				.where(
					and(
						eq(events.treeId, treeId),
						eq(events.entityType, entityType),
						inArray(events.entityId, chunk),
						types ? inArray(events.type, [...types]) : undefined
					)
				)
		);
	}

	/** The first person recorded in the tree: the default focus when nobody has chosen one. */
	async firstPersonId(treeId: string): Promise<string | null> {
		const row = await this.db
			.select({ id: individuals.id })
			.from(individuals)
			.where(eq(individuals.treeId, treeId))
			.orderBy(asc(sql`${individuals}.rowid`))
			.limit(1)
			.get();
		return row?.id ?? null;
	}

	async counts(treeId: string): Promise<TreeCounts> {
		const total = (table: typeof individuals | typeof unions | typeof parentChild | typeof events | typeof mediaItems) =>
			this.db.select({ n: count() }).from(table).where(eq(table.treeId, treeId));
		const [people, unionCount, links, eventCount, media] = (await this.db.batch([
			total(individuals),
			total(unions),
			total(parentChild),
			total(events),
			total(mediaItems)
		])) as Array<Array<{ n: number }>>;
		return { people: people[0]!.n, unions: unionCount[0]!.n, links: links[0]!.n, events: eventCount[0]!.n, media: media[0]!.n };
	}
}
