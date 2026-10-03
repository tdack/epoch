import { treeHandler } from '#lib/server/http/handler.js';
import { ListService } from '#lib/server/services/list-service.js';
import { parseListParams } from '#lib/shared/lists.js';

/** One page of surnames with counts: `?offset=&limit=`. */
export const GET = treeHandler({ failure: 'Failed to list surnames' }, ({ db, ctx, treeId, url }) =>
	new ListService(db).surnames(treeId, parseListParams(url.searchParams), ctx)
);
