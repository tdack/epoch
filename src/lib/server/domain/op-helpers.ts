/**
 * Helpers the per-record op builders share: row lookups, the optimistic-version error, the touch
 * that bumps a row's version, event upserts and the file-detach rule. Split out of `tree-ops.ts`
 * so `person-ops.ts` and `union-ops.ts` do not import back from the module that dispatches to them.
 */

import {
	type EventRow,
	type IndividualRow,
	type RowOp,
	type TableRows,
	type TreeRows,
	type UnionRow,
	rowOp
} from './change-log';
import { dateColumnsFor } from './date-columns';
import { ConcurrencyConflictError, NotFoundError } from './errors';
import { mediaLinkId } from '../../shared/media';

export interface OpContext {
	treeId: string;
	/** Epoch milliseconds, stamped on every row written. */
	now: number;
	newId: () => string;
	/** The user making the change, recorded as the author of a person it creates. */
	actorId: string | null;
}

export function cleanText(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export function partnerIdsOf(rows: TreeRows, unionId: string): string[] {
	return rows.unionPartners
		.filter((p) => p.unionId === unionId)
		.sort((a, b) => a.order - b.order)
		.map((p) => p.personId);
}

export function requirePerson(rows: TreeRows, id: string): IndividualRow {
	const person = rows.individuals.find((p) => p.id === id);
	if (!person) throw new NotFoundError('Person', id);
	return person;
}

export function requireUnion(rows: TreeRows, id: string): UnionRow {
	const union = rows.unions.find((u) => u.id === id);
	if (!union) throw new NotFoundError('Union', id);
	return union;
}

export function eventsOf(
	rows: TreeRows,
	entityType: 'INDIVIDUAL' | 'FAMILY',
	entityId: string
): EventRow[] {
	return rows.events.filter((e) => e.entityType === entityType && e.entityId === entityId);
}

/** Thrown when a client edited from a version that is no longer current; carries what is current. */
export function staleVersion(
	entity: 'individual' | 'union',
	id: string,
	currentVersion: number,
	expected: number,
	current: object
) {
	return new ConcurrencyConflictError(
		`This ${entity === 'individual' ? 'person' : 'partnership'} was changed by someone else (you had version ${expected}, it is now ${currentVersion}).`,
		{ reason: 'STALE_VERSION', entity, id, expectedVersion: expected, currentVersion, current }
	);
}

export function touch<T extends { version: number; updatedAt: number | null }>(
	row: T,
	ctx: OpContext
): T {
	return { ...row, version: row.version + 1, updatedAt: ctx.now };
}

/**
 * Links of the given records are removed, not the files: the bytes stay, and undo hangs each file
 * back on its record. A file linked to a record that survives stays on it. The media row is not
 * bumped, so a file reached by two of these in one change (a person and their sole partnership) is
 * never written twice against one version.
 */
export function unlinkFilesOf(rows: TreeRows, ownerIds: ReadonlySet<string>): RowOp[] {
	return rows.mediaLinks
		.filter((l) => ownerIds.has(l.entityId))
		.map((link) => ({ table: 'media_links' as const, id: link.id, before: link, after: null }));
}

/**
 * Moves the files of `fromIds` to `toId`: each link is removed and the survivor is linked unless it
 * already is, so a file on both sides of a merge ends with one link.
 */
export function relinkFiles(
	rows: TreeRows,
	ctx: Pick<OpContext, 'now'>,
	fromIds: ReadonlySet<string>,
	toId: string
): RowOp[] {
	const ops: RowOp[] = [];
	const linked = new Set(rows.mediaLinks.filter((l) => l.entityId === toId).map((l) => l.mediaId));
	for (const link of rows.mediaLinks.filter((l) => fromIds.has(l.entityId))) {
		ops.push({ table: 'media_links', id: link.id, before: link, after: null });
		if (linked.has(link.mediaId)) continue;
		linked.add(link.mediaId);
		ops.push({
			table: 'media_links',
			id: mediaLinkId(link.mediaId, toId),
			before: null,
			after: { ...link, id: mediaLinkId(link.mediaId, toId), entityId: toId, createdAt: ctx.now }
		});
	}
	return ops;
}

/** An op that bumps a person or union's version because something it owns changed. */
export function bump<T extends 'individuals' | 'unions'>(
	table: T,
	row: TableRows[T],
	ctx: OpContext
): RowOp {
	return rowOp(table, row.id, row, touch(row, ctx));
}

// ---- Events ----

interface EventFields {
	dateText?: string | null;
	place?: string | null;
}

/**
 * Create or update the first event of `type` on an entity. `undefined` leaves a field alone; a
 * missing event is only created when there is something to record, unless `isForced`.
 */
export function upsertEvent(
	rows: TreeRows,
	ctx: OpContext,
	entityType: 'INDIVIDUAL' | 'FAMILY',
	entityId: string,
	type: string,
	fields: EventFields,
	isForced = false
): RowOp[] {
	if (fields.dateText === undefined && fields.place === undefined) return [];
	const existing = eventsOf(rows, entityType, entityId).find((e) => e.type === type);
	if (existing) {
		const dateText = fields.dateText !== undefined ? cleanText(fields.dateText) : existing.dateRaw;
		const after: EventRow = {
			...existing,
			dateRaw: dateText,
			...(fields.dateText !== undefined ? dateColumnsFor(dateText) : {}),
			place: fields.place !== undefined ? cleanText(fields.place) : existing.place
		};
		if (after.dateRaw === existing.dateRaw && after.place === existing.place) return [];
		return [{ table: 'events', id: existing.id, before: existing, after: touch(after, ctx) }];
	}
	const dateText = cleanText(fields.dateText);
	const place = cleanText(fields.place);
	if (!isForced && !dateText && !place) return [];
	return [createEvent(ctx, entityType, entityId, type, dateText, place)];
}

export function createEvent(
	ctx: OpContext,
	entityType: 'INDIVIDUAL' | 'FAMILY',
	entityId: string,
	type: string,
	dateText: string | null,
	place: string | null
): RowOp {
	const id = ctx.newId();
	const row: EventRow = {
		id,
		treeId: ctx.treeId,
		gedcomExtra: null,
		entityType,
		entityId,
		type,
		dateRaw: dateText,
		...dateColumnsFor(dateText),
		place,
		description: null,
		value: null,
		cause: null,
		age: null,
		address: null,
		addressLayout: null,
		classification: null,
		agency: null,
		phone: null,
		email: null,
		fax: null,
		web: null,
		latitude: null,
		longitude: null,
		placeExtra: null,
		dateExtra: null,
		causeExtra: null,
		ageExtra: null,
		religion: null,
		notes: null,
		sortOrder: 0,
		version: 1,
		createdAt: ctx.now,
		updatedAt: ctx.now
	};
	return { table: 'events', id, before: null, after: row };
}
