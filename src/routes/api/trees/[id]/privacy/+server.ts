import { treeHandler } from '#lib/server/http/handler.js';
import { PrivacyService } from '#lib/server/services/privacy-service.js';
import { privacySettingsSchema } from '#lib/server/validation/schemas.js';

/** The tree's privacy settings: how old a birth makes someone not living, and whether private people show as placeholders. */
export const GET = treeHandler(
	{ failure: 'Failed to read the privacy settings' },
	({ db, ctx, treeId }) => new PrivacyService(db).getSettings(treeId, ctx)
);

export const PUT = treeHandler(
	{ failure: 'Failed to save the privacy settings', body: privacySettingsSchema },
	({ db, ctx, treeId, body }) => new PrivacyService(db).updateSettings(treeId, body, ctx)
);
