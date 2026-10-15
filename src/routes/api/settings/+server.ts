import { apiHandler } from '#lib/server/http/handler.js';
import { SettingsService } from '#lib/server/services/settings-service.js';
import { settingsPatchSchema } from '#lib/server/validation/schemas.js';

/**
 * The site default, the caller's own choices and what they resolve to. The public visitor may read
 * this: it holds colours and a motion flag, never anyone's record.
 */
export const GET = apiHandler(
	{ failure: 'Failed to load settings', allowPublicVisitor: true },
	({ db, ctx }) => new SettingsService(db).view(ctx)
);

/** Changes the caller's own colours and motion setting. */
export const PUT = apiHandler(
	{ failure: 'Failed to save settings', body: settingsPatchSchema },
	({ db, ctx, body }) => new SettingsService(db).updateMine(body, ctx)
);
