import { treeHandler } from '#lib/server/http/handler.js';
import { ListService } from '#lib/server/services/list-service.js';
import { parseListParams } from '#lib/shared/lists.js';

/** One page of surnames with counts: `?offset=&limit=`. */
export const GET = treeHandler(
	{ allowPublicVisitor: true, failure: 'Failed to list surnames' },
	({ db, ctx, treeId, subtree, url }) =>
		new ListService(db).surnames(
			treeId,
			parseListParams(url.searchParams),
			ctx,
			subtree?.rootPersonId ?? null
		)
);
