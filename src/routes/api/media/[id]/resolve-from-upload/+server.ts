import { apiHandler } from '#lib/server/http/handler.js';
import { BindingUnavailableError } from '#lib/server/domain/errors.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { resolveFromUploadSchema } from '#lib/server/validation/schemas.js';

/**
 * Stores the bytes of a finished upload as an unresolved file ("Add file…", ADR-082). `id` is the
 * file's own id, since a secondary file of an object resolves on its own. The session names the tree.
 */
export const POST = apiHandler(
	{
		failure: 'Failed to add the file',
		body: resolveFromUploadSchema,
		params: ['id'],
		status: 201
	},
	async ({ db, ctx, event, params, body }) => {
		const bucket = event.platform?.env?.MEDIA_BUCKET;
		if (!bucket) throw new BindingUnavailableError('MEDIA_BUCKET');
		return new MediaService(db).resolveFromUpload(
			{ sessionId: body.sessionId, fileId: params.id!, expectedVersion: body.version },
			bucket,
			ctx
		);
	}
);
