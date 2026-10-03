import { listQuery, treeLoad } from '#lib/services/load-helpers.js';
import { fetchList } from '#lib/services/tree-api.js';
import type { UnionListItem } from '#lib/shared/lists.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, url, fetch }) => ({
	page: await fetchList<UnionListItem>(params.id, 'unions', listQuery(url), fetch)
}));
