import { BindingUnavailableError } from '#lib/server/domain/errors.js';
import { apiHandler } from '#lib/server/http/handler.js';
import { UploadService } from '#lib/server/services/upload-service.js';

/** Abandons an upload and frees its parts. Safe to repeat. */
export const DELETE = apiHandler(
	{ failure: 'Failed to cancel the upload', params: ['id'] },
	async ({ db, ctx, event, params }) => {
		const bucket = event.platform?.env?.MEDIA_BUCKET;
		if (!bucket) throw new BindingUnavailableError('MEDIA_BUCKET');
		await new UploadService(db, bucket).abort(params.id!, ctx);
		return new Response(null, { status: 204 });
	}
);
