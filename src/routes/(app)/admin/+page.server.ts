import { error } from '@sveltejs/kit';
import { serverLoad } from '#lib/server/http/page-load.js';
import { PublicTreeService } from '#lib/server/services/public-tree-service.js';
import { SettingsService } from '#lib/server/services/settings-service.js';
import { SETTINGS_DEPENDENCY } from '#lib/shared/settings.js';
import type { PageServerLoad } from './$types';

/**
 * The whole install, for its owner alone (ADR-075). Everyone else gets a 404, so the page's
 * existence is not confirmed to them; the services behind it refuse them again.
 */
export const load: PageServerLoad = serverLoad(
	{ failure: 'Failed to load administration' },
	async ({ db, ctx }, { depends }) => {
		if (!ctx.user.isInstallOwner) error(404, 'Not found');
		depends(SETTINGS_DEPENDENCY);
		const [installTrees, settings] = await Promise.all([
			new PublicTreeService(db).listAll(ctx),
			new SettingsService(db).view(ctx)
		]);
		return { installTrees, settings };
	}
);
