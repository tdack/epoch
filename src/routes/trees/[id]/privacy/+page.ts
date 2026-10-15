import { treeLoad } from '#lib/api/load-helpers.js';
import { fetchPrivacySettings } from '#lib/api/tree-api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, fetch }) => ({
	settings: await fetchPrivacySettings(params.id, fetch)
}));
