import { BindingUnavailableError } from '#lib/server/domain/errors.js';
import { apiHandler } from '#lib/server/http/handler.js';
import { ProfileService } from '#lib/server/services/profile-service.js';

/** Copies the Google picture Access sent with this request in as the caller's avatar. */
export const POST = apiHandler(
	{ failure: 'Failed to use your Google picture' },
	({ db, ctx, event }) => {
		const bucket = event.platform?.env?.MEDIA_BUCKET;
		if (!bucket) throw new BindingUnavailableError('MEDIA_BUCKET');
		return new ProfileService(db).useAccessPicture(bucket, ctx);
	}
);
