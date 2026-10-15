import { treeLoad } from '#lib/api/load-helpers.js';
import { searchTreeApi } from '#lib/api/lists.js';
import { DEFAULT_SEARCH_LIMIT, parseSearchParams } from '#lib/shared/search.js';
import type { PageLoad } from './$types';

/** The query lives in the address, so a refresh, the back button and a bookmark all keep it. */
export const load: PageLoad = treeLoad(async ({ params, url, fetch }) => {
	const query = parseSearchParams(url.searchParams);
	const isAsking = Boolean(query.text || query.place || query.from || query.to);
	if (!isAsking) return { query, response: null };
	const forward = new URLSearchParams();
	for (const key of ['q', 'place', 'from', 'to', 'offset']) {
		const value = url.searchParams.get(key);
		if (value) forward.set(key, value);
	}
	forward.set('limit', String(DEFAULT_SEARCH_LIMIT));
	return { query, response: await searchTreeApi(params.id, forward, fetch) };
});
