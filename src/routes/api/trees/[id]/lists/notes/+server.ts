import { treeHandler } from '#lib/server/http/handler.js';
import { NoteReadService } from '#lib/server/services/note-read-service.js';
import { parseListParams } from '#lib/shared/lists.js';

/** One page of shared notes, by text: `?q=&offset=&limit=`. `q` matches the words of the note. */
export const GET = treeHandler(
	{ allowPublicVisitor: true, failure: 'Failed to list the notes' },
	({ db, ctx, treeId, url }) =>
		new NoteReadService(db).listNotes(
			treeId,
			{ ...parseListParams(url.searchParams), q: url.searchParams.get('q') ?? '' },
			ctx
		)
);
