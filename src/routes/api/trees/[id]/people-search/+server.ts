import { treeHandler } from '#lib/server/http/handler.js';
import { SearchService } from '#lib/server/services/search-service.js';
import { parseSearchParams } from '#lib/shared/search.js';

export const GET = treeHandler(
	{ failure: 'Failed to search people' },
	async ({ db, ctx, treeId, url }) => {
		// The focus box and relationship dialog ask for names only, so place and dates are not read.
		const { text, limit } = parseSearchParams(url.searchParams);
		const { people } = await new SearchService(db).search(treeId, { text, limit }, ctx);
		return { people };
	}
);
