import { treeHandler } from '#lib/server/http/handler.js';
import { NoteService } from '#lib/server/services/note-service.js';
import { noteImpactSchema } from '#lib/server/validation/schemas.js';

/** Preview deleting or merging shared notes, or removing a note from a record: which records it would change. Saves nothing. */
export const POST = treeHandler(
	{ failure: 'Failed to preview the change', body: noteImpactSchema },
	async ({ db, ctx, treeId, body }) => {
		const command =
			body.kind === 'delete_shared_note'
				? {
						kind: 'delete_shared_note' as const,
						noteId: body.noteId,
						expectedVersion: body.version,
						shouldDetach: body.shouldDetach
					}
				: body.kind === 'merge_notes'
					? {
							kind: 'merge_notes' as const,
							survivorId: body.survivorId,
							mergedIds: body.mergedIds
						}
					: {
							kind: 'remove_note' as const,
							attachmentId: body.attachmentId,
							expectedVersion: body.version
						};
		return { impact: await new NoteService(db).preview(treeId, command, ctx) };
	}
);
