import { listQuery, treeLoad } from '#lib/services/load-helpers.js';
import { fetchSource } from '#lib/services/tree-api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, url, fetch }) => ({
	source: await fetchSource(params.id, params.sourceId, listQuery(url), fetch)
}));
