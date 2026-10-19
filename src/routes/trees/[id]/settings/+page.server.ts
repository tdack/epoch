import { error } from '@sveltejs/kit';
import { treeServerLoad } from '#lib/server/http/page-load.js';
import { SettingsService } from '#lib/server/services/settings-service.js';
import { SETTINGS_DEPENDENCY } from '#lib/shared/settings.js';
import type { PageServerLoad } from './$types';

/**
 * A person's own colours, and the install owner's site default (ADR-054). The settings belong to
 * the person, not the tree: the page sits under a tree only to keep the header and section menu.
 * The public visitor has no settings of their own, so the page is not theirs.
 */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load settings', allowPublicVisitor: true },
	async ({ db, ctx }, { parent, depends }) => {
		depends(SETTINGS_DEPENDENCY);
		const { summary } = await parent();
		if (summary.viewer.isPublicVisitor) error(404, 'Not found');
		return { settings: await new SettingsService(db).view(ctx) };
	}
);
