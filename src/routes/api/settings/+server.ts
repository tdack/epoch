import { apiHandler } from '#lib/server/http/handler.js';
import { SettingsService } from '#lib/server/services/settings-service.js';
import { settingsPatchSchema } from '#lib/server/validation/schemas.js';

/** Changes the caller's own colours and motion setting. */
export const PUT = apiHandler(
	{ failure: 'Failed to save settings', body: settingsPatchSchema },
	({ db, ctx, body }) => new SettingsService(db).updateMine(body, ctx)
);
