import { treeHandler } from '#lib/server/http/handler.js';
import { NoteService } from '#lib/server/services/note-service.js';
import { noteMergeSchema } from '#lib/server/validation/schemas.js';

/** Fold duplicate shared notes into this one: every use moves to it, and the merge is one undoable change. */
export const POST = treeHandler(
	{ failure: 'Failed to merge the notes', params: ['noteId'], body: noteMergeSchema },
	async ({ db, ctx, treeId, params, body }) => {
		const { change } = await new NoteService(db).mergeNotes(
			treeId,
			params.noteId,
			body.mergedIds,
			body.expectedVersions,
			ctx
		);
		return { change };
	}
);
