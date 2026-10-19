import { treeServerLoad } from '#lib/server/http/page-load.js';
import { SearchService } from '#lib/server/services/search-service.js';
import { DEFAULT_SEARCH_LIMIT, parseSearchParams } from '#lib/shared/search.js';
import type { PageServerLoad } from './$types';

/** The query lives in the address, so a refresh, the back button and a bookmark all keep it. */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to search the tree', allowPublicVisitor: true },
	async ({ db, ctx, treeId, subtree }, { url }) => {
		const query = parseSearchParams(url.searchParams);
		const isAsking = Boolean(query.text || query.place || query.from || query.to);
		if (!isAsking) return { query, response: null };
		const response = await new SearchService(db).search(
			treeId,
			{ ...query, limit: DEFAULT_SEARCH_LIMIT },
			ctx,
			subtree?.rootPersonId ?? null
		);
		return { query, response };
	}
);
