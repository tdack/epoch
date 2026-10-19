import { treeServerLoad } from '#lib/server/http/page-load.js';
import { NoteReadService } from '#lib/server/services/note-read-service.js';
import { parseListParams } from '#lib/shared/lists.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the note', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { params, url }) => ({
		note: await new NoteReadService(db).getNote(
			treeId,
			params.noteId,
			parseListParams(url.searchParams),
			ctx
		)
	})
);
