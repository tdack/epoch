import { treeHandler } from '#lib/server/http/handler.js';
import { GraphQueryService } from '#lib/server/services/graph-query-service.js';

/** The tree's name, counts and default focus: what a page needs before it has a person to draw. */
export const GET = treeHandler(
	{ allowPublicVisitor: true, failure: 'Failed to load the tree summary' },
	({ db, ctx, treeId, subtree }) => new GraphQueryService(db).summary(treeId, ctx, subtree)
);
