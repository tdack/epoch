import { apiHandler } from '#lib/server/http/handler.js';
import { SettingsService } from '#lib/server/services/settings-service.js';
import { siteSettingsPatchSchema } from '#lib/server/validation/schemas.js';

/** Changes the install-wide colour defaults. The install owner alone may (ADR-054). */
export const PUT = apiHandler(
	{ failure: 'Failed to save the site default', body: siteSettingsPatchSchema },
	({ db, ctx, body }) => new SettingsService(db).updateSite(body, ctx)
);
