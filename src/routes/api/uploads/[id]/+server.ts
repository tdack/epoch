import { BindingUnavailableError } from '#lib/server/domain/errors.js';
import { apiHandler } from '#lib/server/http/handler.js';
import type { UploadSessionStateDto } from '#lib/shared/uploads.js';
import { UploadService } from '#lib/server/services/upload-service.js';

/** Where an open upload stands, for a client resuming it after a reload. Only its creator may ask. */
export const GET = apiHandler(
	{ failure: 'Failed to read the upload', params: ['id'] },
	async ({ db, ctx, event, params }): Promise<UploadSessionStateDto> => {
		const bucket = event.platform?.env?.MEDIA_BUCKET;
		if (!bucket) throw new BindingUnavailableError('MEDIA_BUCKET');
		return new UploadService(db, bucket).describe(params.id!, ctx);
	}
);

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
