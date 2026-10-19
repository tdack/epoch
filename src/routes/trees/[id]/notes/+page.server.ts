import { treeServerLoad } from '#lib/server/http/page-load.js';
import { NoteReadService } from '#lib/server/services/note-read-service.js';
import { parseListParams } from '#lib/shared/lists.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to list the notes', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { url }) => {
		const q = url.searchParams.get('q') ?? '';
		return {
			q,
			page: await new NoteReadService(db).listNotes(
				treeId,
				{ ...parseListParams(url.searchParams), q },
				ctx
			)
		};
	}
);
