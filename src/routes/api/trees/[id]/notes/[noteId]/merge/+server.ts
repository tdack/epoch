import { treeHandler } from '#lib/server/http/handler.js';
import { NoteService } from '#lib/server/services/note-service.js';
import { noteMergeSchema } from '#lib/server/validation/schemas.js';

/**
 * Fold duplicate shared notes into this one: every use moves to it, and the merge is one undoable
 * change. One too big for a change moves the uses in steps: `remaining` is those still to move, and
 * the caller repeats the request until it is 0.
 */
export const POST = treeHandler(
	{ failure: 'Failed to merge the notes', params: ['noteId'], body: noteMergeSchema },
	async ({ db, ctx, treeId, params, body }) => {
		const { change, remaining = 0 } = await new NoteService(db).mergeNotes(
			treeId,
			params.noteId,
			body.mergedIds,
			body.expectedVersions,
			ctx
		);
		return { change, remaining };
	}
);
