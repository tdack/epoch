import { listQuery, treeLoad } from '#lib/api/load-helpers.js';
import { fetchPlaces } from '#lib/api/tree-api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, url, fetch }) => {
	const q = url.searchParams.get('q') ?? '';
	return { q, page: await fetchPlaces(params.id, listQuery(url, { q }), fetch) };
});
