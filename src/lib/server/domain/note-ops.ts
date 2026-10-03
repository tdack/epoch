/**
 * Row operations for notes (ADR-029): add, edit, remove and reorder a subject's notes, share an
 * inline note, attach, create, edit, delete and merge shared notes. A note is owned by one subject
 * (`noteCascadeOps`, `makeNoteMover`), so a delete or merge of the subject moves or removes its
 * attachments in the same change and an undo brings them back.
 *
 * Adding a note does not touch its subject's version, as for a citation (ADR-028): a contributor
 * may annotate what they may see, and annotating is not an edit of the claim.
 */

import type { NoteAttachmentRow, NoteRow, RowOp, TreeRows } from './change-log';
import { ConcurrencyConflictError, NoteInUseError, NotFoundError, ValidationError } from './errors';
import {
	MAX_NOTE_OPS,
	NOTE_SUBJECT_KINDS,
	type NoteSubjectKind,
	type NoteSubjectRef,
	type SharedNoteInput
} from '../../shared/notes';

export type NoteCommand =
	| { kind: 'add_note'; attachmentId: string; subject: NoteSubjectRef; text: string }
	| { kind: 'update_note'; attachmentId: string; expectedVersion?: number; text: string }
	| { kind: 'remove_note'; attachmentId: string; expectedVersion?: number }
	| {
			kind: 'reorder_notes';
			subject: NoteSubjectRef;
			/** Every note of the subject, in the order they should now be written. */
			orderedAttachmentIds: string[];
	  }
	| {
			/** Turn an inline note into a shared one: its text becomes the record, and it points there. */
			kind: 'share_note';
			attachmentId: string;
			noteId: string;
			expectedVersion?: number;
	  }
	| { kind: 'attach_note'; attachmentId: string; subject: NoteSubjectRef; noteId: string }
	| { kind: 'create_note'; noteId: string; note: SharedNoteInput }
	| {
			kind: 'update_shared_note';
			noteId: string;
			expectedVersion?: number;
			note: SharedNoteInput;
	  }
	| {
			kind: 'delete_shared_note';
			noteId: string;
			expectedVersion?: number;
			/** Without this, a note that is used is refused. */
			shouldDetach?: boolean;
	  }
	| {
			kind: 'merge_notes';
			/** The note that remains; its XREF stays the primary one. */
			survivorId: string;
			/** The notes folded into it and deleted; every use moves to the survivor. */
			mergedIds: string[];
			expectedVersions?: Record<string, number>;
	  };

export interface NoteContext {
	treeId: string;
	/** Epoch milliseconds, stamped on every row written. */
	now: number;
	newId: () => string;
	/** The user making the change, recorded as the author of a shared note it creates. */
	actorId: string | null;
}

/** Text that keeps its line breaks but not stray space at the ends. */
const cleanBlock = (value: string | null | undefined): string | null =>
	value?.replace(/\r\n?/g, '\n').trim() || null;
const clean = (value: string | null | undefined): string | null => value?.trim() || null;

function touch<T extends { version: number; updatedAt: number | null }>(
	row: T,
	ctx: Pick<NoteContext, 'now'>
): T {
	return { ...row, version: row.version + 1, updatedAt: ctx.now };
}

function checkVersion(
	row: { id: string; version: number },
	expected: number | undefined,
	entity: 'note' | 'note_link',
	snapshot: Record<string, unknown>
): void {
	if (expected === undefined || row.version === expected) return;
	throw new ConcurrencyConflictError(
		`This note was changed by someone else (you had version ${expected}, it is now ${row.version}).`,
		{
			reason: 'STALE_VERSION',
			entity,
			id: row.id,
			expectedVersion: expected,
			currentVersion: row.version,
			current: snapshot
		}
	);
}

export function requireNote(rows: TreeRows, id: string): NoteRow {
	const note = rows.notes.find((n) => n.id === id);
	if (!note) throw new NotFoundError('Note', id);
	return note;
}

export function requireAttachment(rows: TreeRows, id: string): NoteAttachmentRow {
	const attachment = rows.noteAttachments.find((a) => a.id === id);
	if (!attachment) throw new NotFoundError('Note', id);
	return attachment;
}

/** Throws when what a note is attached to is not in the tree. */
function requireSubject(rows: TreeRows, subject: NoteSubjectRef): void {
	const lists: Record<NoteSubjectKind, Array<{ id: string }>> = {
		[NOTE_SUBJECT_KINDS.PERSON]: rows.individuals,
		[NOTE_SUBJECT_KINDS.NAME]: rows.personNames,
		[NOTE_SUBJECT_KINDS.EVENT]: rows.events,
		[NOTE_SUBJECT_KINDS.UNION]: rows.unions,
		[NOTE_SUBJECT_KINDS.PARENT_CHILD]: rows.parentChild,
		[NOTE_SUBJECT_KINDS.SOURCE]: rows.sources,
		[NOTE_SUBJECT_KINDS.CITATION]: rows.citations,
		[NOTE_SUBJECT_KINDS.REPOSITORY]: rows.repositories
	};
	if (!lists[subject.kind]?.some((row) => row.id === subject.id))
		throw new NotFoundError('Record to annotate', subject.id);
}

/** A short XREF for a note made here: stable, in the file's own style, and not one already taken. */
function newXref(id: string, taken: Set<string>): string {
	const token = id.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
	for (let length = 8; length <= token.length; length++) {
		const xref = `@N${token.slice(0, length)}@`;
		if (!taken.has(xref)) return xref;
	}
	return `@N${token}${taken.size}@`;
}

const takenXrefs = (list: Array<{ xref: string | null; xrefAliases: string[] | null }>) =>
	new Set(list.flatMap((r) => [...(r.xref ? [r.xref] : []), ...(r.xrefAliases ?? [])]));

const noteSnapshot = (n: NoteRow) => ({ text: n.text, mime: n.mime, language: n.language });
const attachmentSnapshot = (a: NoteAttachmentRow) => ({ text: a.text });

const ownOf = (rows: TreeRows, subject: NoteSubjectRef) =>
	rows.noteAttachments
		.filter((a) => a.subjectKind === subject.kind && a.subjectId === subject.id)
		.sort((a, b) => a.sortOrder - b.sortOrder);

/** An attachment that holds its own text: neither a pointer at a record nor at one the file lacked. */
export const isInlineAttachment = (a: Pick<NoteAttachmentRow, 'noteId' | 'noteRef'>) =>
	a.noteId === null && a.noteRef === null;

function limited(ops: RowOp[], reason: string): RowOp[] {
	if (ops.length > MAX_NOTE_OPS)
		throw new ValidationError(
			`${reason}: it would change ${ops.length} records, and one change writes at most ${MAX_NOTE_OPS}.`
		);
	return ops;
}

function newAttachment(
	ctx: NoteContext,
	id: string,
	subject: NoteSubjectRef,
	sortOrder: number,
	fields: Pick<NoteAttachmentRow, 'noteId' | 'text'>
): NoteAttachmentRow {
	return {
		id,
		treeId: ctx.treeId,
		subjectKind: subject.kind,
		subjectId: subject.id,
		sortOrder,
		noteId: fields.noteId,
		noteRef: null,
		gedcomTag: null,
		text: fields.text,
		gedcomExtra: null,
		gedcomLayout: null,
		version: 1,
		createdAt: ctx.now,
		updatedAt: ctx.now
	};
}

// ---- A subject's notes ----

function addNote(
	rows: TreeRows,
	ctx: NoteContext,
	command: Extract<NoteCommand, { kind: 'add_note' }>
): RowOp[] {
	requireSubject(rows, command.subject);
	const text = cleanBlock(command.text);
	if (!text) throw new ValidationError('A note needs some text.');
	const own = ownOf(rows, command.subject);
	const ops = legacyDescriptionOps(rows, ctx, command.subject);
	const row = newAttachment(
		ctx,
		command.attachmentId,
		command.subject,
		Math.max(-1, ...own.map((a) => a.sortOrder), ...ops.map(() => 0)) + 1,
		{ noteId: null, text }
	);
	return [...ops, { table: 'note_attachments', id: row.id, before: null, after: row }];
}

/**
 * An individual's fact imported before facts had fields keeps its note in `description` (ADR-012),
 * and export writes that as the note only while the fact has none of its own. Giving the fact a
 * note record would hide it, so it first becomes a note itself, and stays visible and written.
 */
function legacyDescriptionOps(rows: TreeRows, ctx: NoteContext, subject: NoteSubjectRef): RowOp[] {
	if (subject.kind !== NOTE_SUBJECT_KINDS.EVENT) return [];
	const event = rows.events.find((e) => e.id === subject.id);
	if (
		!event ||
		event.entityType !== 'INDIVIDUAL' ||
		!event.description ||
		event.notes ||
		ownOf(rows, subject).length > 0
	)
		return [];
	const row = newAttachment(ctx, ctx.newId(), subject, 0, {
		noteId: null,
		text: event.description
	});
	return [
		{
			table: 'events',
			id: event.id,
			before: event,
			after: touch({ ...event, description: null }, ctx)
		},
		{ table: 'note_attachments', id: row.id, before: null, after: row }
	];
}

function updateNote(
	rows: TreeRows,
	ctx: NoteContext,
	command: Extract<NoteCommand, { kind: 'update_note' }>
): RowOp[] {
	const before = requireAttachment(rows, command.attachmentId);
	checkVersion(before, command.expectedVersion, 'note_link', attachmentSnapshot(before));
	if (!isInlineAttachment(before))
		throw new ValidationError('This note is shared; edit the shared note itself.');
	const text = cleanBlock(command.text);
	if (!text) throw new ValidationError('A note needs some text.');
	if (text === before.text) return [];
	return [
		{
			table: 'note_attachments',
			id: before.id,
			before,
			// The file's own line split described the old words; it is dropped with them.
			after: touch({ ...before, text, gedcomLayout: null }, ctx)
		}
	];
}

function removeNote(
	rows: TreeRows,
	_ctx: NoteContext,
	command: Extract<NoteCommand, { kind: 'remove_note' }>
): RowOp[] {
	const attachment = requireAttachment(rows, command.attachmentId);
	checkVersion(attachment, command.expectedVersion, 'note_link', attachmentSnapshot(attachment));
	// A shared note is only detached: it stays a record, possibly with no use, until someone deletes it.
	return [{ table: 'note_attachments', id: attachment.id, before: attachment, after: null }];
}

function reorderNotes(
	rows: TreeRows,
	ctx: NoteContext,
	command: Extract<NoteCommand, { kind: 'reorder_notes' }>
): RowOp[] {
	requireSubject(rows, command.subject);
	const own = ownOf(rows, command.subject);
	const ids = command.orderedAttachmentIds;
	if (
		new Set(ids).size !== ids.length ||
		ids.length !== own.length ||
		!own.every((a) => ids.includes(a.id))
	)
		throw new ValidationError('The new order must list each note of this record once.');
	const ops: RowOp[] = [];
	ids.forEach((id, index) => {
		const attachment = own.find((a) => a.id === id)!;
		if (attachment.sortOrder !== index)
			ops.push({
				table: 'note_attachments',
				id,
				before: attachment,
				after: touch({ ...attachment, sortOrder: index }, ctx)
			});
	});
	return ops;
}

function createSharedNoteRow(
	rows: TreeRows,
	ctx: NoteContext,
	id: string,
	input: SharedNoteInput
): NoteRow {
	const text = cleanBlock(input.text);
	if (!text) throw new ValidationError('A note needs some text.');
	return {
		id,
		treeId: ctx.treeId,
		xref: newXref(id, takenXrefs(rows.notes)),
		xrefAliases: null,
		text,
		mime: clean(input.mime),
		language: clean(input.language),
		gedcomTag: null,
		gedcomExtra: null,
		gedcomLayout: null,
		createdBy: ctx.actorId,
		version: 1,
		createdAt: ctx.now,
		updatedAt: ctx.now
	};
}

function shareNote(
	rows: TreeRows,
	ctx: NoteContext,
	command: Extract<NoteCommand, { kind: 'share_note' }>
): RowOp[] {
	const before = requireAttachment(rows, command.attachmentId);
	checkVersion(before, command.expectedVersion, 'note_link', attachmentSnapshot(before));
	if (!isInlineAttachment(before) || !before.text)
		throw new ValidationError('Only a note written on a record can be shared.');
	const note = createSharedNoteRow(rows, ctx, command.noteId, { text: before.text });
	// The inline note's own line split and the lines kept under it move to the record, so
	// nothing the file said about this note is lost by sharing it.
	const shared: NoteRow = {
		...note,
		gedcomLayout: before.gedcomLayout,
		gedcomExtra: before.gedcomExtra
	};
	return [
		{ table: 'notes', id: shared.id, before: null, after: shared },
		{
			table: 'note_attachments',
			id: before.id,
			before,
			after: touch(
				{
					...before,
					noteId: shared.id,
					text: null,
					gedcomLayout: null,
					gedcomExtra: null
				},
				ctx
			)
		}
	];
}

function attachNote(
	rows: TreeRows,
	ctx: NoteContext,
	command: Extract<NoteCommand, { kind: 'attach_note' }>
): RowOp[] {
	requireSubject(rows, command.subject);
	requireNote(rows, command.noteId);
	const own = ownOf(rows, command.subject);
	if (own.some((a) => a.noteId === command.noteId))
		throw new ValidationError('That note is already on this record.');
	const ops = legacyDescriptionOps(rows, ctx, command.subject);
	const row = newAttachment(
		ctx,
		command.attachmentId,
		command.subject,
		Math.max(-1, ...own.map((a) => a.sortOrder), ...ops.map(() => 0)) + 1,
		{ noteId: command.noteId, text: null }
	);
	return [...ops, { table: 'note_attachments', id: row.id, before: null, after: row }];
}

// ---- Shared notes ----

function createNote(
	rows: TreeRows,
	ctx: NoteContext,
	command: Extract<NoteCommand, { kind: 'create_note' }>
): RowOp[] {
	const row = createSharedNoteRow(rows, ctx, command.noteId, command.note);
	return [{ table: 'notes', id: row.id, before: null, after: row }];
}

function updateSharedNote(
	rows: TreeRows,
	ctx: NoteContext,
	command: Extract<NoteCommand, { kind: 'update_shared_note' }>
): RowOp[] {
	const before = requireNote(rows, command.noteId);
	checkVersion(before, command.expectedVersion, 'note', noteSnapshot(before));
	const patch = command.note;
	const text = patch.text !== undefined ? cleanBlock(patch.text) : before.text;
	if (!text) throw new ValidationError('A note needs some text.');
	const after: NoteRow = {
		...before,
		text,
		mime: patch.mime !== undefined ? clean(patch.mime) : before.mime,
		language: patch.language !== undefined ? clean(patch.language) : before.language,
		// The file's own line split described the old words; it is dropped with them.
		...(text !== before.text ? { gedcomLayout: null } : {})
	};
	if (JSON.stringify(after) === JSON.stringify(before)) return [];
	return [{ table: 'notes', id: before.id, before, after: touch(after, ctx) }];
}

const usesOf = (rows: TreeRows, noteId: string) =>
	rows.noteAttachments.filter((a) => a.noteId === noteId);

function deleteSharedNote(
	rows: TreeRows,
	_ctx: NoteContext,
	command: Extract<NoteCommand, { kind: 'delete_shared_note' }>
): RowOp[] {
	const note = requireNote(rows, command.noteId);
	checkVersion(note, command.expectedVersion, 'note', noteSnapshot(note));
	const uses = usesOf(rows, note.id);
	if (uses.length > 0 && !command.shouldDetach) {
		throw new NoteInUseError(
			`${uses.length} ${uses.length === 1 ? 'record uses' : 'records use'} this note. Detach ${uses.length === 1 ? 'it' : 'them'} too to delete the note.`,
			uses.length
		);
	}
	return limited(
		[
			...uses.map((a): RowOp => ({ table: 'note_attachments', id: a.id, before: a, after: null })),
			{ table: 'notes', id: note.id, before: note, after: null }
		],
		'This note is used too widely to delete in one change'
	);
}

function mergeNotes(
	rows: TreeRows,
	ctx: NoteContext,
	command: Extract<NoteCommand, { kind: 'merge_notes' }>
): RowOp[] {
	const mergedIds = [...new Set(command.mergedIds)].filter((id) => id !== command.survivorId);
	if (mergedIds.length === 0) throw new ValidationError('Choose at least two notes to merge.');
	const survivor = requireNote(rows, command.survivorId);
	const merged = mergedIds.map((id) => requireNote(rows, id));
	for (const note of [survivor, ...merged])
		checkVersion(note, command.expectedVersions?.[note.id], 'note', noteSnapshot(note));

	const ops: RowOp[] = [];
	const mergedSet = new Set(mergedIds);
	// Every use moves to the survivor; a record that would then point at it twice keeps one pointer.
	const pointing = new Set(
		rows.noteAttachments
			.filter((a) => a.noteId === survivor.id)
			.map((a) => `${a.subjectKind}|${a.subjectId}`)
	);
	for (const use of rows.noteAttachments.filter((a) => a.noteId && mergedSet.has(a.noteId))) {
		const slot = `${use.subjectKind}|${use.subjectId}`;
		if (pointing.has(slot)) {
			ops.push({ table: 'note_attachments', id: use.id, before: use, after: null });
			continue;
		}
		pointing.add(slot);
		ops.push({
			table: 'note_attachments',
			id: use.id,
			before: use,
			after: touch({ ...use, noteId: survivor.id }, ctx)
		});
	}

	// The survivor's own words win; a blank one is filled from the others, and lines the model keeps
	// are carried over rather than dropped.
	const fill = <K extends 'text' | 'mime' | 'language'>(key: K) =>
		survivor[key] ?? merged.map((m) => m[key]).find((v) => v !== null) ?? null;
	const extras = [...(survivor.gedcomExtra ?? [])];
	for (const note of merged) {
		const block = note.gedcomExtra ?? [];
		if (block.length > 0 && !extras.join('\n').includes(block.join('\n'))) extras.push(...block);
	}
	const aliases = [...(survivor.xrefAliases ?? [])];
	for (const note of merged) {
		for (const alias of [note.xref, ...(note.xrefAliases ?? [])]) {
			if (alias && alias !== survivor.xref && !aliases.includes(alias)) aliases.push(alias);
		}
		ops.push({ table: 'notes', id: note.id, before: note, after: null });
	}
	ops.push({
		table: 'notes',
		id: survivor.id,
		before: survivor,
		after: touch(
			{
				...survivor,
				text: fill('text'),
				mime: fill('mime'),
				language: fill('language'),
				gedcomExtra: extras.length > 0 ? extras : null,
				xrefAliases: aliases.length > 0 ? aliases : null
			},
			ctx
		)
	});
	return limited(ops, 'These notes are used too widely to merge in one change');
}

export function buildNoteOps(rows: TreeRows, command: NoteCommand, ctx: NoteContext): RowOp[] {
	switch (command.kind) {
		case 'add_note':
			return addNote(rows, ctx, command);
		case 'update_note':
			return updateNote(rows, ctx, command);
		case 'remove_note':
			return removeNote(rows, ctx, command);
		case 'reorder_notes':
			return reorderNotes(rows, ctx, command);
		case 'share_note':
			return shareNote(rows, ctx, command);
		case 'attach_note':
			return attachNote(rows, ctx, command);
		case 'create_note':
			return createNote(rows, ctx, command);
		case 'update_shared_note':
			return updateSharedNote(rows, ctx, command);
		case 'delete_shared_note':
			return deleteSharedNote(rows, ctx, command);
		case 'merge_notes':
			return mergeNotes(rows, ctx, command);
	}
}

// ---- A fact's note, for the fact editor ----

/**
 * What the fact editor does to a fact's notes: its note field is the fact's first note written on
 * the fact itself. `text` undefined leaves notes alone; blank removes that note; otherwise it is
 * written, as a new note when the fact has no inline one. A legacy description (ADR-012) is the
 * note the field shows, so editing the fact turns it into one first.
 */
export function factNoteOps(
	rows: TreeRows,
	ctx: NoteContext,
	eventId: string,
	text: string | null | undefined
): RowOp[] {
	if (text === undefined) return [];
	const subject: NoteSubjectRef = { kind: NOTE_SUBJECT_KINDS.EVENT, id: eventId };
	const own = ownOf(rows, subject);
	const first = own.find(isInlineAttachment);
	const words = cleanBlock(text);
	if (first) {
		if (!words) return [{ table: 'note_attachments', id: first.id, before: first, after: null }];
		if (words === first.text) return [];
		return [
			{
				table: 'note_attachments',
				id: first.id,
				before: first,
				after: touch({ ...first, text: words, gedcomLayout: null }, ctx)
			}
		];
	}
	if (!words) return [];
	const row = newAttachment(
		ctx,
		ctx.newId(),
		subject,
		Math.max(-1, ...own.map((a) => a.sortOrder)) + 1,
		{ noteId: null, text: words }
	);
	return [{ table: 'note_attachments', id: row.id, before: null, after: row }];
}

/** A legacy description becomes the fact's first note when the fact is edited and says nothing new. */
export function factDescriptionToNoteOps(
	rows: TreeRows,
	ctx: NoteContext,
	eventId: string
): RowOp[] {
	const event = rows.events.find((e) => e.id === eventId);
	if (!event?.description || event.notes) return [];
	const subject: NoteSubjectRef = { kind: NOTE_SUBJECT_KINDS.EVENT, id: eventId };
	if (ownOf(rows, subject).length > 0) return [];
	const row = newAttachment(ctx, ctx.newId(), subject, 0, {
		noteId: null,
		text: event.description
	});
	return [{ table: 'note_attachments', id: row.id, before: null, after: row }];
}

// ---- Notes follow their subject ----

const NOTE_SUBJECT_TABLES = {
	individuals: NOTE_SUBJECT_KINDS.PERSON,
	person_names: NOTE_SUBJECT_KINDS.NAME,
	events: NOTE_SUBJECT_KINDS.EVENT,
	unions: NOTE_SUBJECT_KINDS.UNION,
	parent_child: NOTE_SUBJECT_KINDS.PARENT_CHILD,
	sources: NOTE_SUBJECT_KINDS.SOURCE,
	citations: NOTE_SUBJECT_KINDS.CITATION,
	repositories: NOTE_SUBJECT_KINDS.REPOSITORY
} as const;

/**
 * Deletes for the notes of every subject these ops delete, so no command that removes a person, a
 * name, a fact, a partnership, a link, a source, a repository or a citation has to remember its
 * notes, and an undo restores them with them. A shared note the attachment pointed at stays: it is
 * a record of its own, detached. An attachment an op already handles (a merge moving it) is left
 * to that op.
 */
export function noteCascadeOps(rows: TreeRows, ops: RowOp[]): RowOp[] {
	if (rows.noteAttachments.length === 0) return [];
	const gone = new Set(
		ops
			.filter((op) => op.after === null && op.table in NOTE_SUBJECT_TABLES)
			.map((op) => `${NOTE_SUBJECT_TABLES[op.table as keyof typeof NOTE_SUBJECT_TABLES]}|${op.id}`)
	);
	if (gone.size === 0) return [];
	const handled = new Set(ops.filter((op) => op.table === 'note_attachments').map((op) => op.id));
	return rows.noteAttachments
		.filter((a) => gone.has(`${a.subjectKind}|${a.subjectId}`) && !handled.has(a.id))
		.map((a): RowOp => ({ table: 'note_attachments', id: a.id, before: a, after: null }));
}

/**
 * Moves notes from one subject to another, after the ones the target has and in their own order,
 * for the commands that fold one record into another. State is kept across calls so two records
 * folded into one survivor do not collide. A shared note the target already points at is not
 * pointed at twice: that attachment is removed instead.
 */
export function makeNoteMover(rows: TreeRows, ctx: Pick<NoteContext, 'now'>) {
	const next = new Map<string, number>();
	const pointing = new Set<string>();
	for (const a of rows.noteAttachments) {
		const key = `${a.subjectKind}|${a.subjectId}`;
		next.set(key, Math.max(next.get(key) ?? 0, a.sortOrder + 1));
		if (a.noteId) pointing.add(`${key}|${a.noteId}`);
	}
	return {
		move(from: NoteSubjectRef, to: NoteSubjectRef): RowOp[] {
			const moved = rows.noteAttachments
				.filter((a) => a.subjectKind === from.kind && a.subjectId === from.id)
				.sort((a, b) => a.sortOrder - b.sortOrder);
			const toKey = `${to.kind}|${to.id}`;
			return moved.map((attachment): RowOp => {
				if (attachment.noteId && pointing.has(`${toKey}|${attachment.noteId}`))
					return {
						table: 'note_attachments',
						id: attachment.id,
						before: attachment,
						after: null
					};
				if (attachment.noteId) pointing.add(`${toKey}|${attachment.noteId}`);
				const sortOrder = next.get(toKey) ?? 0;
				next.set(toKey, sortOrder + 1);
				return {
					table: 'note_attachments',
					id: attachment.id,
					before: attachment,
					after: {
						...attachment,
						subjectKind: to.kind,
						subjectId: to.id,
						sortOrder,
						version: attachment.version + 1,
						updatedAt: ctx.now
					}
				};
			});
		}
	};
}
