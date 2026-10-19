import { treeServerLoad } from '#lib/server/http/page-load.js';
import { PrivacyService } from '#lib/server/services/privacy-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to read the privacy settings' },
	async ({ db, ctx, treeId }) => ({
		settings: await new PrivacyService(db).getSettings(treeId, ctx)
	})
);
