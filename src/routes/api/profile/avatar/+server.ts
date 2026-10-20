import { BindingUnavailableError, ValidationError } from '#lib/server/domain/errors.js';
import { parseBoundedFormData } from '#lib/server/http/bounded-form.js';
import { apiHandler } from '#lib/server/http/handler.js';
import { enforceRateLimit } from '#lib/server/http/rate-limit.js';
import { ProfileService } from '#lib/server/services/profile-service.js';
import { MAX_AVATAR_BYTES } from '#lib/shared/profile.js';

function bucketOf(event: { platform?: App.Platform }) {
	const bucket = event.platform?.env?.MEDIA_BUCKET;
	if (!bucket) throw new BindingUnavailableError('MEDIA_BUCKET');
	return bucket;
}

/** Replaces the caller's avatar with an uploaded image. */
export const POST = apiHandler(
	{ failure: 'Failed to upload your picture' },
	async ({ db, ctx, event }) => {
		const bucket = bucketOf(event);
		// Before the body is read, so a refused upload costs nothing to parse.
		await enforceRateLimit({
			binding: event.platform?.env?.UPLOAD_RATE_LIMIT,
			bindingName: 'UPLOAD_RATE_LIMIT',
			key: ctx.user.id,
			message: 'Too many uploads; try again in a minute'
		});
		const file = (await parseBoundedFormData(event.request, MAX_AVATAR_BYTES)).get('file');
		// A text field named `file` is not a file; its `size` would be undefined and skip the cap.
		if (!(file instanceof File)) throw new ValidationError('file is required');
		return new ProfileService(db).saveAvatar(new Uint8Array(await file.arrayBuffer()), bucket, ctx);
	}
);

/** Removes the caller's avatar, so the header shows initials again. */
export const DELETE = apiHandler(
	{ failure: 'Failed to remove your picture' },
	({ db, ctx, event }) => new ProfileService(db).removeAvatar(bucketOf(event), ctx)
);
