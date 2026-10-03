/**
 * Parsed notes as the rows that store them (ADR-029). The import and the backfill both build their
 * rows here, so a tree backfilled from retained lines and the same file imported fresh hold the
 * same records.
 */

import type { noteAttachments, notes } from '../db/schema';
import type { NoteSubjectRef } from '../../shared/notes';
import type { ParsedNoteLink, ParsedSharedNote } from './note-parse';

type NoteInsert = typeof notes.$inferInsert;
type NoteAttachmentInsert = typeof noteAttachments.$inferInsert;

const orNull = <T>(value: T | undefined): T | null => value ?? null;
const keptOrNull = (lines: string[] | undefined) => (lines && lines.length > 0 ? lines : null);

export function noteRow(
	treeId: string,
	id: string,
	parsed: ParsedSharedNote,
	createdAt: Date
): NoteInsert {
	return {
		id,
		treeId,
		xref: parsed.id,
		text: orNull(parsed.text),
		mime: orNull(parsed.mime),
		language: orNull(parsed.language),
		gedcomTag: parsed.tag,
		gedcomExtra: keptOrNull(parsed.extra),
		gedcomLayout: parsed.layout ?? null,
		createdAt,
		updatedAt: createdAt
	};
}

/**
 * A note on a subject. `noteId` is the stored note a pointer resolves to; a pointer that resolves
 * to nothing is kept as `noteRef`, so a note of a record the file lacks is still written back.
 */
export function noteAttachmentRow(
	treeId: string,
	id: string,
	subject: NoteSubjectRef,
	parsed: ParsedNoteLink,
	noteId: string | null,
	sortOrder: number,
	createdAt: Date
): NoteAttachmentInsert {
	return {
		id,
		treeId,
		subjectKind: subject.kind,
		subjectId: subject.id,
		sortOrder,
		noteId,
		noteRef: noteId === null ? orNull(parsed.pointer) : null,
		gedcomTag: parsed.pointer ? parsed.tag : null,
		text: parsed.pointer ? null : orNull(parsed.text),
		gedcomExtra: keptOrNull(parsed.extra),
		gedcomLayout: parsed.layout ?? null,
		createdAt,
		updatedAt: createdAt
	};
}

/**
 * What makes two notes of one subject the same on a merge-mode import or a backfill: the shared
 * note they point at (by id, or by the pointer it could not resolve) or their inline text. Two
 * identical notes on one subject are told apart by the caller counting occurrences.
 */
export function storedNoteKey(a: {
	noteId: string | null;
	noteRef: string | null;
	text: string | null;
}): string {
	return [a.noteId ?? a.noteRef, a.text].map((p) => p ?? '').join('\u0000');
}
