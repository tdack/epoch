import { treeLoad } from '#lib/api/load-helpers.js';
import { fetchUnionPage } from '#lib/api/relationships.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, fetch }) => ({
	union: await fetchUnionPage(params.id, params.unionId, fetch)
}));
