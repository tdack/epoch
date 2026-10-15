import { treeLoad } from '#lib/api/load-helpers.js';
import { fetchQuality } from '#lib/api/lists.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, fetch }) => ({
	report: await fetchQuality(params.id, fetch)
}));
