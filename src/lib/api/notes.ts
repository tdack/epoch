import type { ImpactResponse } from '#lib/shared/api-contracts.js';
import type { ChangeSummary, ImpactSummary } from '#lib/types/genealogy.js';
import type { NoteListItem, NoteSubjectRef, SharedNoteInput } from '#lib/shared/notes.js';
import type { Page } from '#lib/shared/lists.js';
import { type Changed, call, json, path } from './client.js';

export async function fetchNotes(
	treeId: string,
	params: URLSearchParams,
	fetcher: typeof fetch = fetch
): Promise<Page<NoteListItem>> {
	return call(
		path`/api/trees/${treeId}/lists/notes` + `?${params}`,
		{ method: 'GET' },
		'Failed to list the notes',
		fetcher
	);
}

export async function createSharedNoteApi(
	treeId: string,
	note: SharedNoteInput & { text: string }
): Promise<{ noteId: string; change: ChangeSummary | null }> {
	return call(path`/api/trees/${treeId}/notes`, json('POST', note), 'Failed to add the note');
}

export async function updateSharedNoteApi(
	treeId: string,
	noteId: string,
	note: SharedNoteInput,
	version: number
): Promise<Changed> {
	return call(
		path`/api/trees/${treeId}/notes/${noteId}`,
		json('PUT', { ...note, version }),
		'Failed to save the note'
	);
}

export async function deleteSharedNoteApi(
	treeId: string,
	noteId: string,
	options: { version: number; shouldDetach?: boolean }
): Promise<Changed> {
	const query = new URLSearchParams({ version: String(options.version) });
	if (options.shouldDetach) query.set('detach', 'true');
	return call(
		path`/api/trees/${treeId}/notes/${noteId}` + `?${query}`,
		{ method: 'DELETE' },
		'Failed to delete the note'
	);
}

export async function mergeNotesApi(
	treeId: string,
	survivorId: string,
	body: { mergedIds: string[]; expectedVersions?: Record<string, number> }
): Promise<Changed> {
	return call(
		path`/api/trees/${treeId}/notes/${survivorId}/merge`,
		json('POST', body),
		'Failed to merge the notes'
	);
}

export type NoteImpactRequest =
	| { kind: 'delete_shared_note'; noteId: string; version?: number; shouldDetach?: boolean }
	| { kind: 'merge_notes'; survivorId: string; mergedIds: string[] }
	| { kind: 'remove_note'; attachmentId: string; version?: number };

export async function previewNoteApi(
	treeId: string,
	request: NoteImpactRequest
): Promise<ImpactSummary> {
	const data = await call<ImpactResponse>(
		path`/api/trees/${treeId}/notes/impact`,
		json('POST', request),
		'Failed to preview the change'
	);
	return data.impact;
}

/** Put a note on a record: its words written there. */
export async function addNoteApi(
	treeId: string,
	subject: NoteSubjectRef,
	text: string
): Promise<{ attachmentId: string; change: ChangeSummary | null }> {
	return call(
		path`/api/trees/${treeId}/note-links`,
		json('POST', { subject, text }),
		'Failed to add the note'
	);
}

/** Put an existing shared note on a record. */
export async function attachNoteApi(
	treeId: string,
	subject: NoteSubjectRef,
	noteId: string
): Promise<{ attachmentId: string; change: ChangeSummary | null }> {
	return call(
		path`/api/trees/${treeId}/note-links`,
		json('POST', { subject, noteId }),
		'Failed to attach the note'
	);
}

export async function updateNoteApi(
	treeId: string,
	attachmentId: string,
	text: string,
	version: number
): Promise<Changed> {
	return call(
		path`/api/trees/${treeId}/note-links/${attachmentId}`,
		json('PUT', { text, version }),
		'Failed to save the note'
	);
}

export async function removeNoteApi(
	treeId: string,
	attachmentId: string,
	version: number
): Promise<Changed> {
	return call(
		path`/api/trees/${treeId}/note-links/${attachmentId}` + `?version=${version}`,
		{ method: 'DELETE' },
		'Failed to remove the note'
	);
}

export async function shareNoteApi(
	treeId: string,
	attachmentId: string,
	version: number
): Promise<{ noteId: string; change: ChangeSummary | null }> {
	return call(
		path`/api/trees/${treeId}/note-links/${attachmentId}/share`,
		json('POST', { version }),
		'Failed to share the note'
	);
}

export async function reorderNotesApi(
	treeId: string,
	subject: NoteSubjectRef,
	orderedAttachmentIds: string[]
): Promise<Changed> {
	return call(
		path`/api/trees/${treeId}/note-links/reorder`,
		json('POST', { subject, orderedAttachmentIds }),
		'Failed to reorder the notes'
	);
}
