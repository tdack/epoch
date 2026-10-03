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
	citations,
	events,
	individuals,
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
	RECORD_ACTIONS,
	type EntityType,
	type FieldChange,
	type RecordAction,
	type RecordChange
} from '../../shared/impact';

/** Timestamps become epoch milliseconds so an image survives JSON. */
type Imaged<T> = {
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
export type SourceRow = Imaged<typeof sources.$inferSelect>;
export type RepositoryRow = Imaged<typeof repositories.$inferSelect>;
export type SourceRepositoryRow = Imaged<typeof sourceRepositories.$inferSelect>;
export type CitationRow = Imaged<typeof citations.$inferSelect>;

/** Every row a tree owns that a mutation can touch. */
export interface TreeRows {
	individuals: IndividualRow[];
	personNames: PersonNameRow[];
	unions: UnionRow[];
	unionPartners: UnionPartnerRow[];
	parentChild: ParentChildRow[];
	events: EventRow[];
	mediaItems: MediaRow[];
	sources: SourceRow[];
	repositories: RepositoryRow[];
	sourceRepositories: SourceRepositoryRow[];
	citations: CitationRow[];
}

export type RecordTable =
	| 'individuals'
	| 'person_names'
	| 'unions'
	| 'union_partners'
	| 'parent_child'
	| 'events'
	| 'media_items'
	| 'sources'
	| 'repositories'
	| 'source_repositories'
	| 'citations';

/** Parents before children: creates run in this order and deletes in reverse, so no foreign key is ever dangling. */
const TABLE_RANK: Record<RecordTable, number> = {
	individuals: 0,
	unions: 1,
	person_names: 2,
	union_partners: 3,
	parent_child: 4,
	events: 5,
	media_items: 6,
	// Evidence points at the rows above and at each other: a citation at its source and its subject,
	// a link at its source and repository.
	sources: 7,
	repositories: 8,
	source_repositories: 9,
	citations: 10
};

/** The name a table's rows go by in the log and in previews. */
const ENTITY_TYPES = {
	individuals: 'person',
	person_names: 'name',
	unions: 'union',
	union_partners: 'partner',
	parent_child: 'link',
	events: 'event',
	media_items: 'media',
	sources: 'source',
	repositories: 'repository',
	source_repositories: 'source_link',
	citations: 'citation'
} as const satisfies Record<RecordTable, EntityType>;

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

/**
 * Whether a row still looks the way a change left it. Version and timestamps are ignored: any
 * touch moves them, and an undo only cares that nobody changed the substance. The batch's own
 * version guard, read at the moment of writing, is what protects against a race.
 */
export function matchesImage(current: RowImage | null, expected: RowImage | null): boolean {
	if (current === null || expected === null) return current === expected;
	// Compared by key, not by the order the keys were written in: a row built by a command and the
	// same row read from the table list their columns differently.
	const strip = (image: RowImage) =>
		JSON.stringify(
			Object.entries(image)
				.filter(([key]) => !HOUSEKEEPING_FIELDS.has(key))
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
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
	const deletedIds = (table: RecordTable) =>
		new Set(ops.filter((op) => op.table === table && op.after === null).map((op) => op.id));
	const deletedSources = deletedIds('sources');
	const deletedRepositories = deletedIds('repositories');

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
	// Evidence: a citation of a subject or source that is going, and a repository link of a source or
	// repository that is going, would be left pointing at nothing.
	const isSubjectDeleted = (kind: string, id: string) => {
		switch (kind) {
			case 'person':
				return deletedPeople.has(id);
			case 'union':
				return deletedUnions.has(id);
			case 'name':
				return deleting.has(`person_names:${id}`);
			case 'event':
				return deleting.has(`events:${id}`);
			default:
				return deleting.has(`parent_child:${id}`);
		}
	};
	// A citation the undo moves away from a record that is going (a merge's undo hands it back) is not
	// left behind, so what counts is where it will be, not where it is.
	const citationAfter = new Map(
		ops.filter((op) => op.table === 'citations' && op.after).map((op) => [op.id, op.after!])
	);
	for (const citation of rows.citations) {
		const kept = (citationAfter.get(citation.id) ?? citation) as typeof citation;
		if (
			isSubjectDeleted(kept.subjectKind, kept.subjectId) ||
			(kept.sourceId !== null && deletedSources.has(kept.sourceId))
		)
			add('citations', citation);
	}
	for (const link of rows.sourceRepositories) {
		if (
			deletedSources.has(link.sourceId) ||
			(link.repositoryId !== null && deletedRepositories.has(link.repositoryId))
		)
			add('source_repositories', link);
	}
	return found;
}
