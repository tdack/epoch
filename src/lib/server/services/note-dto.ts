/**
 * Notes as the pages show them (ADR-029): an attachment with the words it carries or points at.
 * The record pages call `loadNoteDtos` with the attachments of subjects the viewer already sees, so
 * a shared note is served exactly when it is attached to one of those.
 */

import type { NoteAttachmentRow, NoteRow } from '../domain/change-log';
import { NoteRepository } from '../repositories/note-repository';
import type { ViewerScope } from './tree-access';
import type { NoteDto, NoteSubjectKind } from '../../shared/notes';

/** What a pointer at a note record the file did not have says: where it pointed. */
const missingText = (ref: string | null) =>
	`Note ${ref ?? ''} (not in this tree)`.replace('  ', ' ');

export function noteDto(
	row: NoteAttachmentRow,
	shared: ReadonlyMap<string, NoteRow>,
	useCounts: ReadonlyMap<string, number>
): NoteDto | null {
	const subject = { kind: row.subjectKind as NoteSubjectKind, id: row.subjectId };
	if (row.noteId) {
		const note = shared.get(row.noteId);
		if (!note) return null;
		return {
			id: row.id,
			version: row.version,
			sortOrder: row.sortOrder,
			subject,
			noteId: note.id,
			noteVersion: note.version,
			text: note.text ?? '',
			isShared: true,
			isMissing: false,
			usedBy: useCounts.get(note.id) ?? 1,
			mime: note.mime,
			language: note.language
		};
	}
	const isMissing = row.noteRef !== null;
	return {
		id: row.id,
		version: row.version,
		sortOrder: row.sortOrder,
		subject,
		noteId: null,
		noteVersion: null,
		text: isMissing ? missingText(row.noteRef) : (row.text ?? ''),
		isShared: false,
		isMissing,
		usedBy: 0,
		mime: null,
		language: null
	};
}

/** Each record's notes together, keyed `kind|id`, in the order they are kept. */
export async function loadNoteDtos(
	repo: NoteRepository,
	treeId: string,
	attachments: NoteAttachmentRow[],
	scope: Pick<ViewerScope, 'isRestricted' | 'cutoff' | 'creatorId'>
): Promise<Map<string, NoteDto[]>> {
	const sharedIds = attachments.flatMap((a) => (a.noteId ? [a.noteId] : []));
	const [sharedRows, counts] = await Promise.all([
		repo.notesByIds(treeId, sharedIds),
		repo.visibleUseCounts(treeId, sharedIds, scope)
	]);
	const shared = new Map(sharedRows.map((n) => [n.id, n]));
	const grouped = new Map<string, NoteDto[]>();
	for (const row of [...attachments].sort((a, b) => a.sortOrder - b.sortOrder)) {
		const dto = noteDto(row, shared, counts);
		if (!dto) continue;
		const key = `${row.subjectKind}|${row.subjectId}`;
		grouped.set(key, [...(grouped.get(key) ?? []), dto]);
	}
	return grouped;
}

/** The notes of one subject from a grouped result. */
export const notesOf = (
	grouped: ReadonlyMap<string, NoteDto[]>,
	kind: NoteSubjectKind,
	id: string
): NoteDto[] => grouped.get(`${kind}|${id}`) ?? [];
