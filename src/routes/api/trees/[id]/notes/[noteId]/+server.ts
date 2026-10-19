import { expectedVersion, treeHandler } from '#lib/server/http/handler.js';
import { NoteService } from '#lib/server/services/note-service.js';
import { sharedNoteUpdateSchema } from '#lib/server/validation/schemas.js';

export const PUT = treeHandler(
	{ failure: 'Failed to save the note', params: ['noteId'], body: sharedNoteUpdateSchema },
	async ({ db, ctx, treeId, params, body: { version, ...note } }) => {
		const { change } = await new NoteService(db).updateSharedNote(
			treeId,
			params.noteId,
			note,
			version,
			ctx
		);
		return { change };
	}
);

/**
 * Delete a shared note. A note that is used is refused with the count (409, `NOTE_IN_USE`) unless
 * the request says to detach it from the records that use it (`?detach=true`).
 */
export const DELETE = treeHandler(
	{ failure: 'Failed to delete the note', params: ['noteId'] },
	async ({ db, ctx, treeId, params, url }) => {
		const { change } = await new NoteService(db).deleteSharedNote(
			treeId,
			params.noteId,
			{
				expectedVersion: expectedVersion(url),
				shouldDetach: url.searchParams.get('detach') === 'true'
			},
			ctx
		);
		return { change };
	}
);
