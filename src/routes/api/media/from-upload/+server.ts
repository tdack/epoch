import { apiHandler } from '#lib/server/http/handler.js';
import { BindingUnavailableError } from '#lib/server/domain/errors.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { mediaFromUploadSchema } from '#lib/server/validation/schemas.js';

/**
 * Makes a media file out of a finished upload session: the bytes are already in R2, so this
 * checks them, files them under their final key and attaches them to a record. The session
 * names the tree, so the caller cannot pick one that disagrees with it.
 */
export const POST = apiHandler(
	{ failure: 'Failed to add the file', body: mediaFromUploadSchema, status: 201 },
	async ({ db, ctx, event, body }) => {
		const bucket = event.platform?.env?.MEDIA_BUCKET;
		if (!bucket) throw new BindingUnavailableError('MEDIA_BUCKET');
		const { id, objectKey, title, mimeType } = await new MediaService(db).recordFromUpload(
			body,
			bucket,
			ctx
		);
		return { media: { id, objectKey, title, mimeType } };
	}
);
