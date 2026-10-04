import { treeHandler } from '#lib/server/http/handler.js';
import { NoteService } from '#lib/server/services/note-service.js';
import { noteLinkShareSchema } from '#lib/server/validation/schemas.js';

/** Turn a note written on a record into a shared note, which the record then points at and others can use. */
export const POST = treeHandler(
	{ failure: 'Failed to share the note', params: ['linkId'], body: noteLinkShareSchema },
	async ({ db, ctx, treeId, params, body }) => {
		const { noteId, change } = await new NoteService(db).shareNote(
			treeId,
			params.linkId,
			body.version,
			ctx
		);
		return { noteId, change };
	}
);
