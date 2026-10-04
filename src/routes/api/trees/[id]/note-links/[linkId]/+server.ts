import { expectedVersion, treeHandler } from '#lib/server/http/handler.js';
import { NoteService } from '#lib/server/services/note-service.js';
import { noteLinkUpdateSchema } from '#lib/server/validation/schemas.js';

/** Edit the words of a note written on a record. A shared note is edited through its own endpoint. */
export const PUT = treeHandler(
	{ failure: 'Failed to save the note', params: ['linkId'], body: noteLinkUpdateSchema },
	async ({ db, ctx, treeId, params, body }) => {
		const { change } = await new NoteService(db).updateNote(
			treeId,
			params.linkId,
			body.text,
			body.version,
			ctx
		);
		return { change };
	}
);

/** Remove a note from a record: an inline note is deleted, a shared note is only detached from it. */
export const DELETE = treeHandler(
	{ failure: 'Failed to remove the note', params: ['linkId'] },
	async ({ db, ctx, treeId, params, url }) => {
		const { change } = await new NoteService(db).removeNote(
			treeId,
			params.linkId,
			expectedVersion(url),
			ctx
		);
		return { change };
	}
);
