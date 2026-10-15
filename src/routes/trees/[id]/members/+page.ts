import { treeLoad } from '#lib/api/load-helpers.js';
import { fetchMembers } from '#lib/api/members.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, fetch }) => ({
	members: await fetchMembers(params.id, fetch)
}));
