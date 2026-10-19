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
	noteAttachments,
	notes,
	parentChild,
	personNames,
	repositories,
	researchTasks,
	sourceRepositories,
	sources,
	subtrees,
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
/**
 * `treeId` is left out of the image of `person_names`, `union_partners` and `source_repositories`
 * on purpose, like `placeId` below: it arrived with migration 0036, so an inverse logged before it
 * lacks the key and must still match the row as it is now. The change store stamps it on insert and
 * scopes writes by it, so no op planner has to carry it.
 */
export type PersonNameRow = Omit<Imaged<typeof personNames.$inferSelect>, 'treeId'>;
export type UnionRow = Imaged<typeof unions.$inferSelect>;
export type UnionPartnerRow = Omit<Imaged<typeof unionPartners.$inferSelect>, 'treeId'>;
export type ParentChildRow = Imaged<typeof parentChild.$inferSelect>;
/**
 * `placeId` is left out of the image on purpose (ADR-019): it is derived from `place` by the change
 * store and the importer. In an image it would have to match the stored row for an undo to accept
 * the row as unchanged, which would make every writer responsible for keeping it right.
 */
export type EventRow = Omit<Imaged<typeof events.$inferSelect>, 'placeId'>;
/**
 * `sizeBytes` and `uploadedBy` are left out of the image for the same reason as `placeId` above:
 * an inverse written before migration 0029 lacks them, and must still match the row as it is now.
 */
export type MediaRow = Omit<Imaged<typeof mediaItems.$inferSelect>, 'sizeBytes' | 'uploadedBy'>;
export type SourceRow = Imaged<typeof sources.$inferSelect>;
export type RepositoryRow = Imaged<typeof repositories.$inferSelect>;
export type SourceRepositoryRow = Omit<Imaged<typeof sourceRepositories.$inferSelect>, 'treeId'>;
export type CitationRow = Imaged<typeof citations.$inferSelect>;
export type NoteRow = Imaged<typeof notes.$inferSelect>;
export type NoteAttachmentRow = Imaged<typeof noteAttachments.$inferSelect>;
export type ResearchTaskRow = Imaged<typeof researchTasks.$inferSelect>;
export type SubtreeRow = Imaged<typeof subtrees.$inferSelect>;

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
	notes: NoteRow[];
	noteAttachments: NoteAttachmentRow[];
	researchTasks: ResearchTaskRow[];
	subtrees: SubtreeRow[];
}

/** Each table's row type, which is what `RowOp` carries so a switch on `table` narrows the row. */
export interface TableRows {
	individuals: IndividualRow;
	person_names: PersonNameRow;
	unions: UnionRow;
	union_partners: UnionPartnerRow;
	parent_child: ParentChildRow;
	events: EventRow;
	media_items: MediaRow;
	sources: SourceRow;
	repositories: RepositoryRow;
	source_repositories: SourceRepositoryRow;
	citations: CitationRow;
	notes: NoteRow;
	note_attachments: NoteAttachmentRow;
	research_tasks: ResearchTaskRow;
	subtree: SubtreeRow;
}

export type RecordTable = keyof TableRows;

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
	citations: 10,
	// Notes point at the rows above (an attachment at its subject, whichever table that is) and at
	// each other: an attachment at its shared note.
	notes: 11,
	note_attachments: 12,
	// A task points at a record of any of the above and nothing points at it.
	research_tasks: 13,
	// Points at a person by id with no foreign key, and nothing points at it.
	subtree: 14
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
	citations: 'citation',
	notes: 'note',
	note_attachments: 'note_link',
	research_tasks: 'task',
	subtree: 'subtree'
} as const satisfies Record<RecordTable, EntityType>;

/**
 * A row of no particular table. Kept for what is genuinely generic: the serialised images in
 * `change_log`, and the comparisons that run over any table's columns by name.
 */
export type RowImage = Record<string, unknown>;

/** One op per table, so `op.table` narrows `before` and `after` to that table's row. */
export type RowOp = {
	[T in RecordTable]: {
		table: T;
		id: string;
		/** The row as it was, or null when the op creates it. */
		before: TableRows[T] | null;
		/** The row as it will be, or null when the op deletes it. */
		after: TableRows[T] | null;
	};
}[RecordTable];

/**
 * Build an op for a table known only as a variable. TypeScript cannot correlate a generic `table`
 * with the union member, so the one cast lives here instead of at every call site.
 */
export function rowOp<T extends RecordTable>(
	table: T,
	id: string,
	before: TableRows[T] | null,
	after: TableRows[T] | null
): RowOp {
	return { table, id, before, after } as RowOp;
}

/** A row paired with its table, for code that is handed the two separately (a labeller call). */
export type TableRow = {
	[T in RecordTable]: { table: T; row: TableRows[T] };
}[RecordTable];

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
	return (
		[...ops]
			.reverse()
			// The swap keeps each image with its own table, which a spread over the union cannot show.
			.map((op) => ({ table: op.table, id: op.id, before: op.after, after: op.before }) as RowOp)
	);
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

/**
 * Fill the keys an image lacks with null. An image written before a migration added a column has
 * no key for it, while the live row has one holding null; without this the two would differ, and
 * an undo of that old change would refuse, or list the column as changed when nothing was.
 */
export function withAllColumns(image: RowImage, columns: Iterable<string>): RowImage {
	const filled: RowImage = { ...image };
	for (const column of columns) if (!(column in filled)) filled[column] = null;
	return filled;
}

/** Both images over the union of their keys, so each side has the same columns. */
function alignedImages(a: RowImage, b: RowImage): [RowImage, RowImage] {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	return [withAllColumns(a, keys), withAllColumns(b, keys)];
}

function changedFields(before: RowImage, after: RowImage): FieldChange[] {
	const fields: FieldChange[] = [];
	const [left, right] = alignedImages(before, after);
	for (const key of Object.keys(left)) {
		if (HOUSEKEEPING_FIELDS.has(key)) continue;
		if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) {
			fields.push({ field: key, before: left[key] ?? null, after: right[key] ?? null });
		}
	}
	return fields;
}

/**
 * Describe each op as a record change. `labelOf` names a row ("John Smith", "John and Jane's
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
	// same row read from the table list their columns differently. A key one side lacks counts as
	// null (see withAllColumns).
	const [left, right] = alignedImages(current, expected);
	const strip = (image: RowImage) =>
		JSON.stringify(
			Object.entries(image)
				.filter(([key]) => !HOUSEKEEPING_FIELDS.has(key))
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		);
	return strip(left) === strip(right);
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
		// The stored inverse is JSON read back from `change_log`, so here the images really are generic.
		let after: RowImage | null = op.after;
		if (after) {
			const previous = versionOf(current) ?? versionOf(after);
			// The restored row gets every column the live row has, so a column the old image predates is
			// written as null rather than left to whatever the database holds.
			if (current) after = withAllColumns(after, Object.keys(current));
			after = {
				...after,
				...(previous === null ? {} : { version: previous + 1 }),
				...('updatedAt' in after ? { updatedAt: nowMs } : {})
			};
		}
		ops.push({ table: op.table, id: op.id, before: current, after } as RowOp);
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
	// A file of a person or partnership that is going would be left pointing at nothing.
	for (const media of rows.mediaItems)
		if (
			media.entityId !== null &&
			(deletedPeople.has(media.entityId) || deletedUnions.has(media.entityId))
		)
			add('media_items', media);
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
	// Notes: an attachment of a subject or shared note that is going would be left pointing at nothing.
	const deletedNotes = deletedIds('notes');
	const isNoteSubjectDeleted = (kind: string, id: string) => {
		switch (kind) {
			case 'source':
				return deletedSources.has(id);
			case 'repository':
				return deletedRepositories.has(id);
			case 'citation':
				return deleting.has(`citations:${id}`);
			default:
				return isSubjectDeleted(kind, id);
		}
	};
	const attachmentAfter = new Map(
		ops.filter((op) => op.table === 'note_attachments' && op.after).map((op) => [op.id, op.after!])
	);
	for (const attachment of rows.noteAttachments) {
		const kept = (attachmentAfter.get(attachment.id) ?? attachment) as typeof attachment;
		if (
			isNoteSubjectDeleted(kept.subjectKind, kept.subjectId) ||
			(kept.noteId !== null && deletedNotes.has(kept.noteId))
		)
			add('note_attachments', attachment);
	}
	// Tasks: one about a record that is going would be left pointing at nothing.
	const taskAfter = new Map(
		ops.filter((op) => op.table === 'research_tasks' && op.after).map((op) => [op.id, op.after!])
	);
	const isTaskSubjectDeleted = (kind: string | null, id: string | null) => {
		if (kind === null || id === null) return false;
		switch (kind) {
			case 'person':
				return deletedPeople.has(id);
			case 'union':
				return deletedUnions.has(id);
			case 'event':
				return deleting.has(`events:${id}`);
			case 'source':
				return deletedSources.has(id);
			default:
				return deletedNotes.has(id);
		}
	};
	for (const task of rows.researchTasks) {
		const kept = (taskAfter.get(task.id) ?? task) as typeof task;
		if (isTaskSubjectDeleted(kept.subjectKind, kept.subjectId)) add('research_tasks', task);
	}
	return found;
}
