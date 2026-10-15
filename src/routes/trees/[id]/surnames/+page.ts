import { listQuery, treeLoad } from '#lib/api/load-helpers.js';
import { fetchList } from '#lib/api/tree-api.js';
import type { SurnameListItem } from '#lib/shared/lists.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, url, fetch }) => ({
	page: await fetchList<SurnameListItem>(params.id, 'surnames', listQuery(url), fetch)
}));
