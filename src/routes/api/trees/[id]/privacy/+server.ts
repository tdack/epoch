import { treeHandler } from '#lib/server/http/handler.js';
import { PrivacyService } from '#lib/server/services/privacy-service.js';
import { privacySettingsSchema } from '#lib/server/validation/schemas.js';

export const PUT = treeHandler(
	{ failure: 'Failed to save the privacy settings', body: privacySettingsSchema },
	({ db, ctx, treeId, body }) => new PrivacyService(db).updateSettings(treeId, body, ctx)
);
