import { treeHandler } from '#lib/server/http/handler.js';
import { NoteService } from '#lib/server/services/note-service.js';
import { noteReorderSchema } from '#lib/server/validation/schemas.js';

/** Put one record's notes in a new order: the order they are shown and written to GEDCOM. */
export const POST = treeHandler(
	{ failure: 'Failed to reorder the notes', body: noteReorderSchema },
	async ({ db, ctx, treeId, body }) => {
		const { change } = await new NoteService(db).reorderNotes(
			treeId,
			body.subject,
			body.orderedAttachmentIds,
			ctx
		);
		return { change };
	}
);
