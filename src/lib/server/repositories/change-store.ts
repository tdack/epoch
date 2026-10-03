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
	parentChild,
	personNames,
	repositories,
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
import { ConcurrencyConflictError } from '../domain/errors';
import { placeKey } from '../../shared/places';
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
	citations
};

/** D1 caps bound parameters per statement at 100; the records insert uses three per row. */
const RECORDS_PER_INSERT = 30;

/** Event ids bound to one place-pointing update, under the same 100-parameter cap. */
const PLACE_IDS_PER_UPDATE = 90;

type ColumnMap = Record<string, { dataType: string }>;

/** Columns the store derives rather than records; see `EventRow`. */
const DERIVED_COLUMNS = new Set(['placeId']);

function columnsOf(table: SQLiteTable): ColumnMap {
	return Object.fromEntries(
		Object.entries(getTableColumns(table)).filter(([key]) => !DERIVED_COLUMNS.has(key))
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
		const { db } = this;
		const [
			inds,
			unionRows,
			partners,
			pcs,
			evs,
			media,
			names,
			sourceRows,
			repoRows,
			linkRows,
			cites
		] = await Promise.all([
			db
				.select()
				.from(individuals)
				.where(eq(individuals.treeId, treeId))
				.orderBy(sql`${individuals}.rowid`)
				.all(),
			db
				.select()
				.from(unions)
				.where(eq(unions.treeId, treeId))
				.orderBy(sql`${unions}.rowid`)
				.all(),
			db
				.select(getTableColumns(unionPartners))
				.from(unionPartners)
				.innerJoin(unions, eq(unionPartners.unionId, unions.id))
				.where(eq(unions.treeId, treeId))
				.orderBy(sql`${unionPartners}.rowid`)
				.all(),
			db
				.select()
				.from(parentChild)
				.where(eq(parentChild.treeId, treeId))
				.orderBy(sql`${parentChild}.rowid`)
				.all(),
			db
				.select()
				.from(events)
				.where(eq(events.treeId, treeId))
				.orderBy(sql`${events}.rowid`)
				.all(),
			db
				.select()
				.from(mediaItems)
				.where(eq(mediaItems.treeId, treeId))
				.orderBy(sql`${mediaItems}.rowid`)
				.all(),
			db
				.select(getTableColumns(personNames))
				.from(personNames)
				.innerJoin(individuals, eq(personNames.personId, individuals.id))
				.where(eq(individuals.treeId, treeId))
				.orderBy(sql`${personNames}.rowid`)
				.all(),
			db
				.select()
				.from(sources)
				.where(eq(sources.treeId, treeId))
				.orderBy(sql`${sources}.rowid`)
				.all(),
			db
				.select()
				.from(repositories)
				.where(eq(repositories.treeId, treeId))
				.orderBy(sql`${repositories}.rowid`)
				.all(),
			db
				.select(getTableColumns(sourceRepositories))
				.from(sourceRepositories)
				.innerJoin(sources, eq(sourceRepositories.sourceId, sources.id))
				.where(eq(sources.treeId, treeId))
				.orderBy(sql`${sourceRepositories}.rowid`)
				.all(),
			db
				.select()
				.from(citations)
				.where(eq(citations.treeId, treeId))
				.orderBy(sql`${citations}.rowid`)
				.all()
		]);
		const images = <T>(table: SQLiteTable, rows: unknown[]) =>
			rows.map((row) => toImage(table, row as Record<string, unknown>)) as T[];
		return {
			individuals: images(individuals, inds),
			unions: images(unions, unionRows),
			unionPartners: images(unionPartners, partners),
			parentChild: images(parentChild, pcs),
			events: images(events, evs),
			mediaItems: images(mediaItems, media),
			personNames: images(personNames, names),
			sources: images(sources, sourceRows),
			repositories: images(repositories, repoRows),
			sourceRepositories: images(sourceRepositories, linkRows),
			citations: images(citations, cites)
		};
	}

	/**
	 * Apply the ops and append the log entry atomically. Returns null when the ops change nothing,
	 * in which case nothing is written and no log row exists.
	 *
	 * @throws ConcurrencyConflictError when a row is no longer at the version the ops were planned on.
	 */
	async commit(input: CommitInput): Promise<CommittedChange | null> {
		const applied = orderForApply(withoutNoOps(input.ops));
		if (applied.length === 0) return null;

		const { db } = this;
		const changeId = crypto.randomUUID();
		const inverse = input.isUndoable ? invertOps(applied) : null;

		const statements = [
			...applied.filter((op) => op.before !== null).map((op) => this.guard(op)),
			...applied.map((op) => this.statementFor(op)),
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
			...chunk(recordsOf(applied), RECORDS_PER_INSERT).map((refs) =>
				db.insert(changeLogRecords).values(refs.map((ref) => ({ changeId, ...ref })))
			)
		];

		try {
			await db.batch(
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
	private guard(op: RowOp) {
		const version = versionOf(op.before);
		const isVersionMatch = version === null ? sql`` : sql` and version = ${version}`;
		const nulls = sql.join(
			Object.keys(getTableColumns(changeLog)).map(() => sql`null`),
			sql`, `
		);
		return (this.db.insert(changeLog) as unknown as { select: (query: unknown) => never }).select(
			sql`select ${nulls} where not exists (select 1 from ${sql.identifier(op.table)} where id = ${op.id}${isVersionMatch})`
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
		const points = chunk(written, PLACE_IDS_PER_UPDATE).map((group) =>
			db
				.update(events)
				.set({ placeId: placeIdOfEvent })
				.where(
					inArray(
						events.id,
						group.map((op) => op.id)
					)
				)
		);
		return [...upserts, ...points];
	}

	private statementFor(op: RowOp) {
		const table = TABLES[op.table];
		const idColumn = (table as unknown as { id: never }).id;
		switch (opKind(op)) {
			case OP_KINDS.CREATE:
				return this.db.insert(table).values(revive(table, op.after!));
			case OP_KINDS.UPDATE:
				return this.db.update(table).set(revive(table, op.after!)).where(eq(idColumn, op.id));
			case OP_KINDS.DELETE:
				return this.db.delete(table).where(eq(idColumn, op.id));
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
		for (const part of chunk(refs, 80)) {
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
	async currentImages(ops: RowOp[]): Promise<Map<string, RowImage>> {
		const images = new Map<string, RowImage>();
		const idsByTable = new Map<RecordTable, string[]>();
		for (const op of ops) idsByTable.set(op.table, [...(idsByTable.get(op.table) ?? []), op.id]);
		for (const [name, ids] of idsByTable) {
			const table = TABLES[name];
			const idColumn = (table as unknown as { id: never }).id;
			for (const part of chunk(ids, 90)) {
				const rows = await this.db.select().from(table).where(inArray(idColumn, part)).all();
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

function chunk<T>(items: T[], size: number): T[][] {
	const parts: T[][] = [];
	for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size));
	return parts;
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
