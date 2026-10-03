import { treeLoad } from '#lib/services/load-helpers.js';
import { fetchMembers } from '#lib/services/tree-api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, fetch }) => ({
	members: await fetchMembers(params.id, fetch)
}));
