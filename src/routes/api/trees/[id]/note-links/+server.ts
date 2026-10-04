import { treeHandler } from '#lib/server/http/handler.js';
import { NoteService } from '#lib/server/services/note-service.js';
import { noteLinkCreateSchema } from '#lib/server/validation/schemas.js';

/**
 * Put a note on one person, name, fact, partnership, parent link, source, repository or citation:
 * its words written there, or an existing shared note attached. A record has as many notes as it
 * is given; they are kept in the order they were added.
 */
export const POST = treeHandler(
	{ failure: 'Failed to add the note', body: noteLinkCreateSchema, status: 201 },
	async ({ db, ctx, treeId, body }) => {
		const service = new NoteService(db);
		const { attachmentId, change } = body.noteId
			? await service.attachNote(treeId, body.subject, body.noteId, ctx)
			: await service.addNote(treeId, body.subject, body.text!, ctx);
		return { attachmentId, change };
	}
);
