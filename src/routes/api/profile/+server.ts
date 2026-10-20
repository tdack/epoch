import { apiHandler } from '#lib/server/http/handler.js';
import { ProfileService } from '#lib/server/services/profile-service.js';
import { profileNameSchema } from '#lib/server/validation/schemas.js';

/** Changes the caller's own display name. */
export const PUT = apiHandler(
	{ failure: 'Failed to save your name', body: profileNameSchema },
	({ db, ctx, body }) => new ProfileService(db).saveName(body.name, ctx)
);
