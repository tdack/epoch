/**
 * Row operations: the unit of every mutation and of undo (ADR-007).
 *
 * A change is planned in memory as a list of `RowOp`s (a row's image before and after), then
 * applied and logged atomically. Because each op carries both images, the inverse of a change is
 * the same list reversed with the images swapped; no per-command inverse has to be written, and
 * nothing depends on knowing why the rows changed.
 *
 * Images are JSON-safe: timestamps are epoch milliseconds, keyed by the schema's property names.
 */

import type {
	events,
	individuals,
	mediaItems,
	parentChild,
	personNames,
	unionPartners,
	unions
} from '../db/schema';

/** Timestamps become epoch milliseconds so an image survives JSON. */
export type Imaged<T> = {
	[K in keyof T]: T[K] extends Date ? number : T[K] extends Date | null ? number | null : T[K];
};

export type IndividualRow = Imaged<typeof individuals.$inferSelect>;
export type PersonNameRow = Imaged<typeof personNames.$inferSelect>;
export type UnionRow = Imaged<typeof unions.$inferSelect>;
export type UnionPartnerRow = Imaged<typeof unionPartners.$inferSelect>;
export type ParentChildRow = Imaged<typeof parentChild.$inferSelect>;
/**
 * `placeId` is left out of the image on purpose (ADR-019): it is derived from `place` by the change
 * store and the importer. In an image it would have to match the stored row for an undo to accept
 * the row as unchanged, which would make every writer responsible for keeping it right.
 */
export type EventRow = Omit<Imaged<typeof events.$inferSelect>, 'placeId'>;
export type MediaRow = Imaged<typeof mediaItems.$inferSelect>;

/** Every row a tree owns that a mutation can touch. */
export interface TreeRows {
	individuals: IndividualRow[];
	personNames: PersonNameRow[];
	unions: UnionRow[];
	unionPartners: UnionPartnerRow[];
	parentChild: ParentChildRow[];
	events: EventRow[];
	mediaItems: MediaRow[];
}

export const RECORD_TABLES = [
	'individuals',
	'person_names',
	'unions',
	'union_partners',
	'parent_child',
	'events',
	'media_items'
] as const;
export type RecordTable = (typeof RECORD_TABLES)[number];

/** Parents before children: creates run in this order and deletes in reverse, so no foreign key is ever dangling. */
const TABLE_RANK: Record<RecordTable, number> = {
	individuals: 0,
	unions: 1,
	person_names: 2,
	union_partners: 3,
	parent_child: 4,
	events: 5,
	media_items: 6
};

/** The name a table's rows go by in the log and in previews. */
export const ENTITY_TYPES = {
	individuals: 'person',
	person_names: 'name',
	unions: 'union',
	union_partners: 'partner',
	parent_child: 'link',
	events: 'event',
	media_items: 'media'
} as const satisfies Record<RecordTable, string>;
export type EntityType = (typeof ENTITY_TYPES)[RecordTable];

export type RowImage = Record<string, unknown>;

export interface RowOp {
	table: RecordTable;
	id: string;
	/** The row as it was, or null when the op creates it. */
	before: RowImage | null;
	/** The row as it will be, or null when the op deletes it. */
	after: RowImage | null;
}

export const OP_KINDS = { CREATE: 'create', UPDATE: 'update', DELETE: 'delete' } as const;
export type OpKind = (typeof OP_KINDS)[keyof typeof OP_KINDS];

export function opKind(op: RowOp): OpKind {
	if (op.before === null) return OP_KINDS.CREATE;
	if (op.after === null) return OP_KINDS.DELETE;
	return OP_KINDS.UPDATE;
}

/** Columns that change on every write and carry no meaning for a person reading the history. */
const HOUSEKEEPING_FIELDS = new Set(['version', 'createdAt', 'updatedAt']);

function isSameImage(a: RowImage | null, b: RowImage | null): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/** Drop ops that change nothing, so a save that edits no field writes no log row. */
export function withoutNoOps(ops: RowOp[]): RowOp[] {
	return ops.filter((op) => !isSameImage(op.before, op.after));
}

/** Creates first (parents before children), then updates, then deletes (children before parents). */
export function orderForApply(ops: RowOp[]): RowOp[] {
	const rank = (op: RowOp) => TABLE_RANK[op.table];
	const creates = ops
		.filter((op) => opKind(op) === OP_KINDS.CREATE)
		.sort((a, b) => rank(a) - rank(b));
	const updates = ops.filter((op) => opKind(op) === OP_KINDS.UPDATE);
	const deletes = ops
		.filter((op) => opKind(op) === OP_KINDS.DELETE)
		.sort((a, b) => rank(b) - rank(a));
	return [...creates, ...updates, ...deletes];
}

/** The ops that revert `ops`: images swapped, and the order reversed. */
export function invertOps(ops: RowOp[]): RowOp[] {
	return [...ops]
		.reverse()
		.map((op) => ({ table: op.table, id: op.id, before: op.after, after: op.before }));
}

export interface AffectedRecordRef {
	entityType: EntityType;
	entityId: string;
}

/** Distinct records a change wrote, for the "did a later change touch these" lookup. */
export function recordsOf(ops: RowOp[]): AffectedRecordRef[] {
	const seen = new Map<string, AffectedRecordRef>();
	for (const op of ops) {
		const entityType = ENTITY_TYPES[op.table];
		seen.set(`${entityType}:${op.id}`, { entityType, entityId: op.id });
	}
	return [...seen.values()];
}

/** A version-bearing row: an update or delete of it is guarded by the version it was planned against. */
export function versionOf(image: RowImage | null): number | null {
	return image && typeof image.version === 'number' ? image.version : null;
}

// ---- What a change did, in words ----

export const RECORD_ACTIONS = {
	CREATED: 'created',
	UPDATED: 'updated',
	DELETED: 'deleted'
} as const;
export type RecordAction = (typeof RECORD_ACTIONS)[keyof typeof RECORD_ACTIONS];

export interface FieldChange {
	field: string;
	before: unknown;
	after: unknown;
}

/** One record's change, in terms a person can read: the summary stored in `change_log.changes_json`. */
export interface RecordChange {
	entityType: EntityType;
	entityId: string;
	label: string;
	action: RecordAction;
	/** Only for updates: the fields whose value differs. */
	fields: FieldChange[];
}

const ACTIONS: Record<OpKind, RecordAction> = {
	create: RECORD_ACTIONS.CREATED,
	update: RECORD_ACTIONS.UPDATED,
	delete: RECORD_ACTIONS.DELETED
};

function changedFields(before: RowImage, after: RowImage): FieldChange[] {
	const fields: FieldChange[] = [];
	for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
		if (HOUSEKEEPING_FIELDS.has(key)) continue;
		if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
			fields.push({ field: key, before: before[key] ?? null, after: after[key] ?? null });
		}
	}
	return fields;
}

/**
 * Describe each op as a record change. `labelOf` names a row ("Homer Simpson", "Homer and Marge's
 * partnership"); it gets the row as it exists after the change, or before it when deleted.
 */
export function describeOps(
	ops: RowOp[],
	labelOf: (table: RecordTable, image: RowImage) => string
): RecordChange[] {
	return withoutNoOps(ops).map((op) => {
		const kind = opKind(op);
		const image = (op.after ?? op.before)!;
		return {
			entityType: ENTITY_TYPES[op.table],
			entityId: op.id,
			label: labelOf(op.table, image),
			action: ACTIONS[kind],
			fields: kind === OP_KINDS.UPDATE ? changedFields(op.before!, op.after!) : []
		};
	});
}

// ---- Undo ----

/** A row of `change_log` as the undo rules see it. */
export interface LoggedChange {
	seq: number;
	id: string;
	actorId: string;
	kind: string;
	summary: string;
	inverse: RowOp[] | null;
	revertsChangeId: string | null;
}

export const UNDO_REFUSALS = {
	NOTHING_TO_UNDO: 'nothing_to_undo',
	TOUCHED_LATER: 'touched_later',
	STATE_CHANGED: 'state_changed',
	HAS_DEPENDENTS: 'has_dependents'
} as const;
export type UndoRefusalReason = (typeof UNDO_REFUSALS)[keyof typeof UNDO_REFUSALS];

/**
 * Whether a row still looks the way a change left it. Version and timestamps are ignored: any
 * touch moves them, and an undo only cares that nobody changed the substance. The batch's own
 * version guard, read at the moment of writing, is what protects against a race.
 */
export function matchesImage(current: RowImage | null, expected: RowImage | null): boolean {
	if (current === null || expected === null) return current === expected;
	const strip = (image: RowImage) =>
		JSON.stringify(
			Object.fromEntries(Object.entries(image).filter(([key]) => !HOUSEKEEPING_FIELDS.has(key)))
		);
	return strip(current) === strip(expected);
}

export interface RebaseMismatch {
	table: RecordTable;
	id: string;
}

/**
 * Turn a stored inverse into ops that apply to the rows as they are now. Each op's `before` becomes
 * the live row (so the write is guarded by its current version) and each restored row gets a
 * version above the live one, which keeps a stale editor's version from matching again after an
 * undo. Returns the first row that no longer looks the way the change left it, if any.
 */
export function rebaseInverse(
	inverse: RowOp[],
	currentImage: (table: RecordTable, id: string) => RowImage | null,
	nowMs: number
): { isOk: true; ops: RowOp[] } | { isOk: false; mismatch: RebaseMismatch } {
	const ops: RowOp[] = [];
	for (const op of inverse) {
		const current = currentImage(op.table, op.id);
		if (!matchesImage(current, op.before))
			return { isOk: false, mismatch: { table: op.table, id: op.id } };
		let after = op.after;
		if (after) {
			const previous = versionOf(current) ?? versionOf(after);
			after = {
				...after,
				...(previous === null ? {} : { version: previous + 1 }),
				...('updatedAt' in after ? { updatedAt: nowMs } : {})
			};
		}
		ops.push({ table: op.table, id: op.id, before: current, after });
	}
	return { isOk: true, ops };
}

/**
 * Rows that still point at a row an undo would delete, and that the undo does not itself delete.
 *
 * Undoing "added Sam" deletes Sam, and the foreign keys would silently take with them a link,
 * partnership or event that someone attached to Sam afterwards. Those rows are not among the
 * records the original change wrote, so the touched-later lookup cannot see them.
 */
export function dependentsOfDeletions(
	rows: TreeRows,
	ops: RowOp[]
): Array<{ table: RecordTable; row: RowImage }> {
	const deleting = new Set(
		ops.filter((op) => op.after === null).map((op) => `${op.table}:${op.id}`)
	);
	const deletedPeople = new Set(
		ops.filter((op) => op.table === 'individuals' && op.after === null).map((op) => op.id)
	);
	const deletedUnions = new Set(
		ops.filter((op) => op.table === 'unions' && op.after === null).map((op) => op.id)
	);
	if (deletedPeople.size === 0 && deletedUnions.size === 0) return [];

	const found: Array<{ table: RecordTable; row: RowImage }> = [];
	const add = (table: RecordTable, row: { id: string }) => {
		if (!deleting.has(`${table}:${row.id}`)) found.push({ table, row: row as RowImage });
	};
	for (const link of rows.parentChild) {
		if (
			deletedPeople.has(link.parentId) ||
			deletedPeople.has(link.childId) ||
			(link.unionId && deletedUnions.has(link.unionId))
		) {
			add('parent_child', link);
		}
	}
	for (const partner of rows.unionPartners) {
		if (deletedPeople.has(partner.personId) || deletedUnions.has(partner.unionId))
			add('union_partners', partner);
	}
	for (const event of rows.events) {
		const isOwnerDeleted =
			event.entityType === 'INDIVIDUAL'
				? deletedPeople.has(event.entityId)
				: deletedUnions.has(event.entityId);
		if (isOwnerDeleted) add('events', event);
	}
	for (const name of rows.personNames) {
		// No foreign key holds a name's partnership (a cascade would change it outside the log), so undoing a
		// created partnership would leave a name pointing at nothing; refuse it as for links and events.
		if (
			deletedPeople.has(name.personId) ||
			(name.unionId !== null && deletedUnions.has(name.unionId))
		)
			add('person_names', name);
	}
	for (const media of rows.mediaItems)
		if (deletedPeople.has(media.entityId)) add('media_items', media);
	return found;
}
