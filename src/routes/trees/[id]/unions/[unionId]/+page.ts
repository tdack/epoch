import { treeLoad } from '#lib/services/load-helpers.js';
import { fetchUnionPage } from '#lib/services/tree-api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, fetch }) => ({
	union: await fetchUnionPage(params.id, params.unionId, fetch)
}));
