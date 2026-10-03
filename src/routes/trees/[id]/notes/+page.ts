import { listQuery, treeLoad } from '#lib/services/load-helpers.js';
import { fetchNotes } from '#lib/services/tree-api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, url, fetch }) => {
	const q = url.searchParams.get('q') ?? '';
	return { q, page: await fetchNotes(params.id, listQuery(url, { q }), fetch) };
});
