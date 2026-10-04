import { treeHandler } from '#lib/server/http/handler.js';
import { NoteService } from '#lib/server/services/note-service.js';
import { sharedNoteCreateSchema } from '#lib/server/validation/schemas.js';

/** Make a shared note. Nothing uses it yet; a note link attaches it to a record. */
export const POST = treeHandler(
	{ failure: 'Failed to add the note', body: sharedNoteCreateSchema, status: 201 },
	async ({ db, ctx, treeId, body }) => {
		const { noteId, change } = await new NoteService(db).createNote(treeId, body, ctx);
		return { noteId, change };
	}
);
