import { treeHandler } from '#lib/server/http/handler.js';
import { MarkService } from '#lib/server/services/mark-service.js';

/** The signed-in user's favourites and recents in this tree. See `MarksDto`. */
export const GET = treeHandler(
	{ failure: 'Failed to load favourites and recents' },
	({ db, ctx, treeId }) => new MarkService(db).get(treeId, ctx)
);
