/**
 * Persists a parsed file's shared notes and the notes under its structures (ADR-029).
 *
 * Identity on a merge-mode import: a shared note is the same record when its XREF, or an alias it
 * was merged under, is already in the tree; a note on a subject is the same when its subject, what
 * it says (its text, or the shared note it points at) and which occurrence of that it is are.
 * Nothing already stored is changed, so importing a file twice writes it once.
 */

import { eq } from 'drizzle-orm';
import type { DbClient } from '../db';
import { noteAttachments, notes } from '../db/schema';
import type { NoteSubjectKind } from '../../shared/notes';
import { treeScopedId } from '../gedcom/import-preview';
import type { ParsedGedcomData } from '../gedcom/parser';
import type { ParsedNoteLink } from '../gedcom/note-parse';
import { noteAttachmentRow, noteRow, storedNoteKey } from '../gedcom/note-rows';
import { chunkByParamLimit } from './param-chunks';

/** Columns Drizzle writes for each table; an insert is chunked by it under D1's parameter cap. */
const NOTE_COLUMNS = 14;
const NOTE_ATTACHMENT_COLUMNS = 14;

/** The notes a parsed structure carries, and the stored row they belong to. */
export interface NoteTarget {
	kind: NoteSubjectKind;
	id: string;
	notes: ParsedNoteLink[];
}

export type NoteLookup = (pointer: string | undefined) => string | null;

/** Insert the file's shared notes; answers how a pointer to one resolves. */
export async function importSharedNotes(
	db: DbClient,
	treeId: string,
	parsed: ParsedGedcomData
): Promise<NoteLookup> {
	const noteIds = new Map<string, string>();
	for (const row of await db
		.select({ id: notes.id, xref: notes.xref, aliases: notes.xrefAliases })
		.from(notes)
		.where(eq(notes.treeId, treeId))
		.all()) {
		if (row.xref) noteIds.set(row.xref, row.id);
		for (const alias of row.aliases ?? []) noteIds.set(alias, row.id);
	}
	const importedAt = new Date();
	const rows: Array<ReturnType<typeof noteRow>> = [];
	for (const note of parsed.notes) {
		if (noteIds.has(note.id)) continue;
		const id = treeScopedId(treeId, note.id);
		noteIds.set(note.id, id);
		rows.push(noteRow(treeId, id, note, importedAt));
	}
	for (const chunk of chunkByParamLimit(rows, NOTE_COLUMNS)) {
		await db.insert(notes).values(chunk).onConflictDoNothing();
	}
	return (pointer) => (pointer ? (noteIds.get(pointer) ?? null) : null);
}

/**
 * Insert the notes of the stored rows they belong to, in file order after whatever the subject
 * already has, skipping any it already says.
 */
export async function importNoteAttachments(
	db: DbClient,
	treeId: string,
	targets: NoteTarget[],
	noteOf: NoteLookup
): Promise<void> {
	if (targets.every((t) => t.notes.length === 0)) return;
	const importedAt = new Date();
	const known = new Map<string, { have: Map<string, number>; next: number }>();
	for (const row of await db
		.select({
			kind: noteAttachments.subjectKind,
			subjectId: noteAttachments.subjectId,
			sortOrder: noteAttachments.sortOrder,
			noteId: noteAttachments.noteId,
			noteRef: noteAttachments.noteRef,
			text: noteAttachments.text
		})
		.from(noteAttachments)
		.where(eq(noteAttachments.treeId, treeId))
		.all()) {
		const entry = known.get(`${row.kind}|${row.subjectId}`) ?? { have: new Map(), next: 0 };
		const key = storedNoteKey(row);
		entry.have.set(key, (entry.have.get(key) ?? 0) + 1);
		entry.next = Math.max(entry.next, row.sortOrder + 1);
		known.set(`${row.kind}|${row.subjectId}`, entry);
	}

	const rows: Array<ReturnType<typeof noteAttachmentRow>> = [];
	for (const target of targets) {
		const slot = `${target.kind}|${target.id}`;
		const entry = known.get(slot) ?? { have: new Map<string, number>(), next: 0 };
		known.set(slot, entry);
		// Two identical notes in one structure are two notes; the same note met again is one.
		const occurrences = new Map<string, number>();
		for (const note of target.notes) {
			const noteId = noteOf(note.pointer);
			const key = storedNoteKey({
				noteId,
				noteRef: noteId === null ? (note.pointer ?? null) : null,
				text: note.pointer ? null : (note.text ?? null)
			});
			const occurrence = (occurrences.get(key) ?? 0) + 1;
			occurrences.set(key, occurrence);
			if (occurrence <= (entry.have.get(key) ?? 0)) continue;
			entry.have.set(key, occurrence);
			rows.push(
				noteAttachmentRow(
					treeId,
					crypto.randomUUID(),
					{ kind: target.kind, id: target.id },
					note,
					noteId,
					entry.next++,
					importedAt
				)
			);
		}
	}
	for (const chunk of chunkByParamLimit(rows, NOTE_ATTACHMENT_COLUMNS)) {
		await db.insert(noteAttachments).values(chunk).onConflictDoNothing();
	}
}

/** The note targets a file's people and partnerships add up to, before names, facts and links. */
export function noteRecordTargets(
	parsed: ParsedGedcomData,
	scoped: (xref: string) => string
): NoteTarget[] {
	return [
		...parsed.individuals.map((ind) => ({
			kind: 'person' as const,
			id: scoped(ind.id),
			notes: ind.notes
		})),
		...parsed.families.map((fam) => ({
			kind: 'union' as const,
			id: scoped(fam.id),
			notes: fam.notes
		}))
	];
}
