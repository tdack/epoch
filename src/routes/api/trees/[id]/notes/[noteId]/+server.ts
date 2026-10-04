import { expectedVersion, treeHandler } from '#lib/server/http/handler.js';
import { NoteReadService } from '#lib/server/services/note-read-service.js';
import { NoteService } from '#lib/server/services/note-service.js';
import { parseListParams } from '#lib/shared/lists.js';
import { sharedNoteUpdateSchema } from '#lib/server/validation/schemas.js';

/**
 * A shared note and a page of the records that use it (`?offset=&limit=`). A note that no record the
 * viewer may see uses, and that they did not make, answers 404, as a private person does.
 */
export const GET = treeHandler(
	{ failure: 'Failed to load the note', params: ['noteId'] },
	({ db, ctx, treeId, params, url }) =>
		new NoteReadService(db).getNote(treeId, params.noteId, parseListParams(url.searchParams), ctx)
);

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
