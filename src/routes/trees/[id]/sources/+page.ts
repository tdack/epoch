import { listQuery, treeLoad } from '#lib/api/load-helpers.js';
import { fetchRepositories, fetchSources } from '#lib/api/evidence.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, url, fetch }) => {
	const q = url.searchParams.get('q') ?? '';
	const [page, repositories] = await Promise.all([
		fetchSources(params.id, listQuery(url, { q }), fetch),
		fetchRepositories(params.id, new URLSearchParams({ limit: '100' }), fetch)
	]);
	return { q, page, repositories };
});
