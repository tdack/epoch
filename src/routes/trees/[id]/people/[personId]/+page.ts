import { treeLoad } from '#lib/api/load-helpers.js';
import { fetchPersonPage } from '#lib/api/tree-api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, fetch }) => ({
	person: await fetchPersonPage(params.id, params.personId, fetch)
}));
