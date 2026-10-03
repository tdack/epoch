import { treeLoad } from '#lib/services/load-helpers.js';
import { fetchQuality } from '#lib/services/tree-api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, fetch }) => ({
	report: await fetchQuality(params.id, fetch)
}));
