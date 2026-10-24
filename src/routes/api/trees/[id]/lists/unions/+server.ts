import { treeHandler } from '#lib/server/http/handler.js';
import { ListService } from '#lib/server/services/list-service.js';
import { parseListParams } from '#lib/shared/lists.js';

/** One page of partnerships in the order they were added: `?offset=&limit=`. */
export const GET = treeHandler(
	{ allowPublicVisitor: true, failure: 'Failed to list the partnerships' },
	({ db, ctx, treeId, url }) =>
		new ListService(db).unions(treeId, parseListParams(url.searchParams), ctx)
);
