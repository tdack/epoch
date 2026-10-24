import { serverLoad } from '#lib/server/http/page-load.js';
import { ProfileService } from '#lib/server/services/profile-service.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import { SettingsService } from '#lib/server/services/settings-service.js';
import { SETTINGS_DEPENDENCY } from '#lib/shared/settings.js';
import type { PageServerLoad } from './$types';

/**
 * Everything about the signed-in person, in every tree (ADR-075). The tree list for "My trees"
 * comes from the app layout. The public visitor has no account, and the loader refuses them by
 * default.
 */
export const load: PageServerLoad = serverLoad(
	{ failure: 'Failed to load your account' },
	async ({ db, ctx }, { depends }) => {
		depends(SETTINGS_DEPENDENCY);
		const profiles = new ProfileService(db);
		const [profile, leave, settings, homePersonNames, selfPersonNames] = await Promise.all([
			profiles.view(ctx),
			profiles.leaveBlockers(ctx),
			new SettingsService(db).view(ctx),
			new TreeService(db).homePersonNames(ctx),
			new TreeService(db).selfPersonNames(ctx)
		]);
		return { profile, leave, settings, homePersonNames, selfPersonNames };
	}
);
