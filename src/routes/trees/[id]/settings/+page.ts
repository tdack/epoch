import { error } from '@sveltejs/kit';
import { treeLoad } from '#lib/services/load-helpers.js';
import { fetchSettings } from '#lib/services/tree-api.js';
import { SETTINGS_DEPENDENCY } from '#lib/shared/settings.js';
import type { PageLoad } from './$types';

/**
 * A person's own colours, and the install owner's site default (ADR-053). The settings belong to
 * the person, not the tree: the page sits under a tree only to keep the header and section menu.
 * The public visitor has no settings of their own, so the page is not theirs.
 */
export const load: PageLoad = treeLoad(async ({ fetch, parent, depends }) => {
	depends(SETTINGS_DEPENDENCY);
	const { summary } = await parent();
	if (summary.viewer.isPublicVisitor) error(404, 'Not found');
	return { settings: await fetchSettings(fetch) };
});
