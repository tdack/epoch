import { treeHandler } from '#lib/server/http/handler.js';
import { SearchService } from '#lib/server/services/search-service.js';
import { parseSearchParams } from '#lib/shared/search.js';

/** Ranked people for `?q=&place=&from=&to=&limit=&offset=`; each says what matched. See `SearchResponse`. */
export const GET = treeHandler(
	{ allowPublicVisitor: true, failure: 'Failed to search the tree' },
	({ db, ctx, treeId, subtree, url }) =>
		new SearchService(db).search(
			treeId,
			parseSearchParams(url.searchParams),
			ctx,
			subtree?.rootPersonId ?? null
		)
);
