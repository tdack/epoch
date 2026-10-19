/**
 * Applies planned row operations and writes the change log, in one atomic batch (ADR-007).
 *
 * Callers plan a change as `RowOp`s against a `TreeRows` snapshot and hand it here. Nothing else
 * in the server writes the mutable tree tables outside an import.
 */

import { and, eq, getTableColumns, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { DbClient } from '../db';
import {
	changeLog,
	changeLogRecords,
	citations,
	events,
	individuals,
	places,
	mediaItems,
	noteAttachments,
	notes,
	parentChild,
	personNames,
	repositories,
	researchTasks,
	subtrees,
	sourceRepositories,
	sources,
	unionPartners,
	unions
} from '../db/schema';
import {
	OP_KINDS,
	invertOps,
	opKind,
	orderForApply,
	recordsOf,
	versionOf,
	withoutNoOps,
	type AffectedRecordRef,
	type LoggedChange,
	type RecordTable,
	type RowImage,
	type RowOp,
	type TreeRows
} from '../domain/change-log';
import { type RecordChange } from '../../shared/impact';
import { ConcurrencyConflictError, ValidationError } from '../domain/errors';
import { placeKey } from '../../shared/places';
import { chunkIds } from './param-chunks';
import { placeIdOfEvent } from './place-repository';

const TABLES: Record<RecordTable, SQLiteTable> = {
	individuals,
	person_names: personNames,
	unions,
	union_partners: unionPartners,
	parent_child: parentChild,
	events,
	media_items: mediaItems,
	sources,
	repositories,
	source_repositories: sourceRepositories,
	citations,
	notes,
	note_attachments: noteAttachments,
	research_tasks: researchTasks,
	subtree: subtrees
};

/** Each `TreeRows` key's table. */
const TREE_ROW_TABLES: Record<keyof TreeRows, SQLiteTable> = {
	individuals,
	unions,
	unionPartners,
	parentChild,
	events,
	mediaItems,
	personNames,
	sources,
	repositories,
	sourceRepositories,
	citations,
	notes,
	noteAttachments,
	researchTasks,
	subtrees
};

/** D1 caps bound parameters per statement at 100; the records insert uses three per row. */
const RECORDS_PER_INSERT = 30;

/** Event ids bound to one place-pointing update, under the same 100-parameter cap. */
const PLACE_IDS_PER_UPDATE = 90;

type ColumnMap = Record<string, { dataType: string }>;

/**
 * Columns left out of row images: `placeId` is derived from `place`; `sizeBytes` and `uploadedBy`
 * arrived with migration 0029, so an inverse written before it has no such keys and would never
 * match a row that has them. See `EventRow` and `MediaRow`.
 */
const DERIVED_COLUMNS = new Set(['placeId', 'sizeBytes', 'uploadedBy']);

/**
 * Child tables whose `tree_id` stays out of row images. Their logged images predate migration 0036,
 * so an inverse written before it has no such key and would never match a row that has one; the
 * commit's own tree is stamped on insert instead.
 */
const STAMPED_TREE_TABLES = new Set<SQLiteTable>([personNames, unionPartners, sourceRepositories]);

/**
 * The table's `tree_id` column, or undefined for a table without one. Read from the Drizzle table so
 * this cannot drift from the schema.
 */
function treeColumnOf(table: SQLiteTable) {
	const columns = getTableColumns(table);
	return 'treeId' in columns ? columns.treeId : undefined;
}

function columnsOf(table: SQLiteTable): ColumnMap {
	// `getTableColumns` on a generic table is not indexable by column name, which every table here is.
	return Object.fromEntries(
		Object.entries(getTableColumns(table)).filter(
			([key]) => !DERIVED_COLUMNS.has(key) && !(key === 'treeId' && STAMPED_TREE_TABLES.has(table))
		)
	) as unknown as ColumnMap;
}

/** A row as JSON-safe values: timestamps become epoch milliseconds. */
export function toImage(table: SQLiteTable, row: Record<string, unknown>): RowImage {
	const image: RowImage = {};
	for (const key of Object.keys(columnsOf(table))) {
		const value = row[key];
		image[key] = value instanceof Date ? value.getTime() : (value ?? null);
	}
	return image;
}

/** The inverse of `toImage`, for handing an image back to drizzle. */
function revive(table: SQLiteTable, image: RowImage): Record<string, unknown> {
	const values: Record<string, unknown> = {};
	for (const [key, column] of Object.entries(columnsOf(table))) {
		const value = image[key];
		values[key] = column.dataType === 'date' && typeof value === 'number' ? new Date(value) : value;
	}
	return values;
}

export interface CommitInput {
	treeId: string;
	actorId: string;
	kind: string;
	summary: string;
	ops: RowOp[];
	/** What the change did in words, already computed from the same ops. */
	changes: RecordChange[];
	isUndoable: boolean;
	/** Set when this change is an undo of another. */
	revertsChangeId?: string | null;
	correlationId?: string | null;
}

export interface CommittedChange {
	id: string;
	kind: string;
	summary: string;
	changes: RecordChange[];
	isUndoable: boolean;
}

export class ChangeStore {
	constructor(private db: DbClient) {}

	/**
	 * Every row of the tree that a mutation can touch, as images, each table in insertion (`rowid`)
	 * order. The order is part of the contract: the union chronology tie-break, the default focus
	 * person and the "first birth" all depend on it, and the bounded graph loader reproduces it so
	 * that a window and the whole tree draw identically.
	 */
	async loadRows(treeId: string): Promise<TreeRows> {
		const keys = Object.keys(TREE_ROW_TABLES) as Array<keyof TreeRows>;
		const tables = await Promise.all(keys.map((key) => this.loadTable(treeId, key)));
		return Object.fromEntries(keys.map((key, i) => [key, tables[i]])) as unknown as TreeRows;
	}

	/**
	 * One table of `loadRows`, in the same order and as the same images. The scoped loader reads a
	 * whole table this way when a command asks for one (ADR-055).
	 */
	async loadTable<K extends keyof TreeRows>(treeId: string, key: K): Promise<TreeRows[K]> {
		const { db } = this;
		const table = TREE_ROW_TABLES[key];
		const byRowid = sql`${table}.rowid`;
		// The child tables are read through their parent rather than by their own `tree_id`: that column
		// can be null on a row written before migration 0036 was backfilled, the parent never is.
		const rows =
			key === 'unionPartners'
				? await db
						.select(getTableColumns(unionPartners))
						.from(unionPartners)
						.innerJoin(unions, eq(unionPartners.unionId, unions.id))
						.where(eq(unions.treeId, treeId))
						.orderBy(byRowid)
						.all()
				: key === 'personNames'
					? await db
							.select(getTableColumns(personNames))
							.from(personNames)
							.innerJoin(individuals, eq(personNames.personId, individuals.id))
							.where(eq(individuals.treeId, treeId))
							.orderBy(byRowid)
							.all()
					: key === 'sourceRepositories'
						? await db
								.select(getTableColumns(sourceRepositories))
								.from(sourceRepositories)
								.innerJoin(sources, eq(sourceRepositories.sourceId, sources.id))
								.where(eq(sources.treeId, treeId))
								.orderBy(byRowid)
								.all()
						: await db
								.select()
								.from(table as typeof individuals)
								.where(eq((table as typeof individuals).treeId, treeId))
								.orderBy(byRowid)
								.all();
		return rows.map((row) => toImage(table, row as Record<string, unknown>)) as TreeRows[K];
	}

	/**
	 * The WHERE clauses scope updates and deletes to the tree, but an insert writes whatever `treeId`
	 * its image carries and an update's SET could move a row into another tree, so no image may name
	 * a tree other than the one being committed. The three child tables carry no `tree_id` in their
	 * images; the commit stamps it on insert, and an update or delete is scoped by it in the WHERE.
	 */
	private requireSingleTree(ops: RowOp[], treeId: string) {
		for (const op of ops) {
			if (!treeColumnOf(TABLES[op.table])) continue;
			for (const image of [op.before, op.after]) {
				const imageTreeId = image && 'treeId' in image ? image.treeId : undefined;
				if (imageTreeId !== undefined && imageTreeId !== treeId) {
					throw new ValidationError('A change may not write across trees');
				}
			}
		}
	}

	/**
	 * Apply the ops and append the log entry atomically. Returns null when the ops change nothing,
	 * in which case nothing is written and no log row exists.
	 *
	 * @throws ConcurrencyConflictError when a row is no longer at the version the ops were planned on.
	 * @throws ValidationError when an op names a row image from another tree.
	 */
	async commit(input: CommitInput): Promise<CommittedChange | null> {
		const applied = orderForApply(withoutNoOps(input.ops));
		if (applied.length === 0) return null;

		this.requireSingleTree(applied, input.treeId);

		const { db } = this;
		const changeId = crypto.randomUUID();
		const inverse = input.isUndoable ? invertOps(applied) : null;

		const statements = [
			...applied.filter((op) => op.before !== null).map((op) => this.guard(op, input.treeId)),
			...applied.map((op) => this.statementFor(op, input.treeId)),
			...this.placeStatements(input.treeId, applied),
			db.insert(changeLog).values({
				id: changeId,
				treeId: input.treeId,
				actorId: input.actorId,
				kind: input.kind,
				summary: input.summary,
				changesJson: JSON.stringify(input.changes),
				inverseJson: inverse ? JSON.stringify(inverse) : null,
				revertsChangeId: input.revertsChangeId ?? null,
				correlationId: input.correlationId ?? null
			}),
			...chunkIds(recordsOf(applied), RECORDS_PER_INSERT).map((refs) =>
				db.insert(changeLogRecords).values(refs.map((ref) => ({ changeId, ...ref })))
			)
		];

		try {
			await db.batch(
				// D1 batch wants a non-empty tuple; the array is checked non-empty above.
				statements as unknown as [(typeof statements)[number], ...(typeof statements)[number][]]
			);
		} catch (error) {
			throw translateBatchError(error);
		}

		return {
			id: changeId,
			kind: input.kind,
			summary: input.summary,
			changes: input.changes,
			isUndoable: input.isUndoable
		};
	}

	/**
	 * A statement that inserts NULL into a NOT NULL column when the row is not at the version the
	 * op was planned on. The constraint failure aborts the whole batch, which is how a version check
	 * becomes part of the transaction; D1 offers no other way to abort a batch on a condition.
	 */
	private guard(op: RowOp, treeId: string) {
		const version = versionOf(op.before);
		const isVersionMatch = version === null ? sql`` : sql` and version = ${version}`;
		// A row in another tree must fail the guard exactly like a missing row: that is the conflict path.
		const treeColumn = treeColumnOf(TABLES[op.table]);
		const treeName = treeColumn ? sql.identifier(treeColumn.name) : sql``;
		const isSameTree = treeColumn ? sql` and ${treeName} = ${treeId}` : sql``;
		const nulls = sql.join(
			Object.keys(getTableColumns(changeLog)).map(() => sql`null`),
			sql`, `
		);
		// Drizzle's typed insert-select cannot take a raw `select ... where not exists` guard.
		return (this.db.insert(changeLog) as unknown as { select: (query: unknown) => never }).select(
			sql`select ${nulls} where not exists (select 1 from ${sql.identifier(op.table)} where id = ${op.id}${isVersionMatch}${isSameTree})`
		);
	}

	/**
	 * Point every written fact at the record for its place text (ADR-019), in the same batch. Doing
	 * it here, from the text, is what lets commands, a union merge and an undo of a change logged
	 * before `place_id` existed all come out right without any of them knowing about records: the
	 * image an op carries has an old or empty `place_id`, and this overwrites it from the text.
	 */
	private placeStatements(treeId: string, ops: RowOp[]) {
		const written = ops.filter((op) => op.table === 'events' && op.after !== null);
		if (written.length === 0) return [];
		const keys = new Set<string>();
		for (const op of written) {
			const place = (op.after as { place?: string | null }).place;
			if (place) keys.add(placeKey(place));
		}
		const { db } = this;
		const upserts = [...keys].map((key) =>
			db
				.insert(places)
				.values({ id: crypto.randomUUID(), treeId, nameKey: key, createdAt: new Date() })
				.onConflictDoNothing()
		);
		const points = chunkIds(written, PLACE_IDS_PER_UPDATE).map((group) =>
			db
				.update(events)
				.set({ placeId: placeIdOfEvent })
				.where(
					and(
						eq(events.treeId, treeId),
						inArray(
							events.id,
							group.map((op) => op.id)
						)
					)
				)
		);
		return [...upserts, ...points];
	}

	/**
	 * Updates and deletes match the tree as well as the id, so a planner that names a row from
	 * another tree touches nothing; the guard above then reports it as a conflict. Inserts carry
	 * their own `tree_id` and are left alone.
	 */
	private statementFor(op: RowOp, treeId: string) {
		const table = TABLES[op.table];
		// Every table in TABLES has an `id` column; the generic SQLiteTable type cannot say so.
		const idColumn = (table as unknown as { id: never }).id;
		const treeColumn = treeColumnOf(table);
		const isOwnRow = treeColumn
			? and(eq(idColumn, op.id), eq(treeColumn, treeId))
			: eq(idColumn, op.id);
		switch (opKind(op)) {
			case OP_KINDS.CREATE:
				// The image has no `tree_id` for these tables, so the commit's own tree is stamped here.
				return this.db
					.insert(table)
					.values(
						STAMPED_TREE_TABLES.has(table)
							? { ...revive(table, op.after!), treeId }
							: revive(table, op.after!)
					);
			case OP_KINDS.UPDATE:
				return this.db.update(table).set(revive(table, op.after!)).where(isOwnRow);
			case OP_KINDS.DELETE:
				return this.db.delete(table).where(isOwnRow);
		}
	}

	// ---- Reading the log ----

	private toLogged(row: typeof changeLog.$inferSelect): LoggedChange {
		return {
			seq: row.seq,
			id: row.id,
			actorId: row.actorId,
			kind: row.kind,
			summary: row.summary,
			inverse: row.inverseJson ? (JSON.parse(row.inverseJson) as RowOp[]) : null,
			revertsChangeId: row.revertsChangeId
		};
	}

	/** The actor's newest change in the tree that can be undone and has not been. */
	async latestUndoable(treeId: string, actorId: string): Promise<LoggedChange | null> {
		const reverts = this.db
			.select({ id: changeLog.revertsChangeId })
			.from(changeLog)
			.where(isNotNull(changeLog.revertsChangeId));
		const row = await this.db
			.select()
			.from(changeLog)
			.where(
				and(
					eq(changeLog.treeId, treeId),
					eq(changeLog.actorId, actorId),
					isNotNull(changeLog.inverseJson),
					isNull(changeLog.revertsChangeId),
					sql`${changeLog.id} not in ${reverts}`
				)
			)
			.orderBy(sql`${changeLog.seq} desc`)
			.limit(1)
			.get();
		return row ? this.toLogged(row) : null;
	}

	/**
	 * The first later change that wrote any of `refs`, ignoring changes that were themselves undone:
	 * a change and its undo cancel out, so they must not block undoing what came before them.
	 */
	async firstTouchedAfter(
		treeId: string,
		seq: number,
		refs: AffectedRecordRef[]
	): Promise<{ summary: string } | null> {
		// D1 binds at most 100 variables a statement and a change can name hundreds of records (a place
		// rename does), so ask a chunk at a time and keep the earliest answer.
		let first: { summary: string; seq: number } | null = null;
		for (const part of chunkIds(refs, 80)) {
			const row = await this.db
				.select({ summary: changeLog.summary, seq: changeLog.seq })
				.from(changeLog)
				.innerJoin(changeLogRecords, eq(changeLogRecords.changeId, changeLog.id))
				.where(
					and(
						eq(changeLog.treeId, treeId),
						gt(changeLog.seq, seq),
						inArray(
							changeLogRecords.entityId,
							part.map((ref) => ref.entityId)
						),
						sql`not exists (select 1 from ${changeLog} as later where later.reverts_change_id = ${changeLog.id})`,
						sql`(${changeLog.revertsChangeId} is null or ${changeLog.revertsChangeId} not in (select id from ${changeLog} as target where target.seq > ${seq}))`
					)
				)
				.orderBy(sql`${changeLog.seq} asc`)
				.limit(1)
				.get();
			if (row && (first === null || row.seq < first.seq)) first = row;
		}
		return first ? { summary: first.summary } : null;
	}

	/** Current images of specific rows, for checking whether an undo still applies. */
	async currentImages(ops: RowOp[], treeId: string): Promise<Map<string, RowImage>> {
		const images = new Map<string, RowImage>();
		const idsByTable = new Map<RecordTable, string[]>();
		for (const op of ops) idsByTable.set(op.table, [...(idsByTable.get(op.table) ?? []), op.id]);
		for (const [name, ids] of idsByTable) {
			const table = TABLES[name];
			// Every table in TABLES has an `id` column; the generic SQLiteTable type cannot say so.
			const idColumn = (table as unknown as { id: never }).id;
			const treeColumn = treeColumnOf(table);
			for (const part of chunkIds(ids)) {
				const isInTree = treeColumn
					? and(inArray(idColumn, part), eq(treeColumn, treeId))
					: inArray(idColumn, part);
				const rows = await this.db.select().from(table).where(isInTree).all();
				for (const row of rows) images.set(`${name}:${row.id}`, toImage(table, row));
			}
		}
		return images;
	}

	/** Recent changes in a tree, newest first. Phase 4's audit view starts from this. */
	async listRecent(treeId: string, limit: number) {
		return this.db
			.select({
				id: changeLog.id,
				seq: changeLog.seq,
				actorId: changeLog.actorId,
				kind: changeLog.kind,
				summary: changeLog.summary,
				createdAt: changeLog.createdAt,
				revertsChangeId: changeLog.revertsChangeId
			})
			.from(changeLog)
			.where(eq(changeLog.treeId, treeId))
			.orderBy(sql`${changeLog.seq} desc`)
			.limit(limit)
			.all();
	}
}

const GUARD_FAILURE = /NOT NULL constraint failed: change_log\./;
const ALREADY_REVERTED = /UNIQUE constraint failed: change_log\.reverts_change_id/;

function translateBatchError(error: unknown): unknown {
	const message = `${(error as Error)?.message ?? ''} ${(error as { cause?: Error })?.cause?.message ?? ''}`;
	if (GUARD_FAILURE.test(message)) {
		// No `current` snapshot here: the batch only knows a row moved, not which entity the person was editing.
		// The version pre-check in the op builders is what produces the detailed STALE_VERSION conflict.
		return new ConcurrencyConflictError(
			'Someone else changed this while you were saving it. Reload and try again.',
			{
				reason: 'CONCURRENT_WRITE'
			}
		);
	}
	if (ALREADY_REVERTED.test(message)) {
		return new ConcurrencyConflictError('That change was already undone.', {
			reason: 'ALREADY_UNDONE'
		});
	}
	return error;
}
