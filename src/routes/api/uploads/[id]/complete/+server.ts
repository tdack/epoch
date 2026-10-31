import { BindingUnavailableError } from '#lib/server/domain/errors.js';
import { apiHandler } from '#lib/server/http/handler.js';
import { UploadService } from '#lib/server/services/upload-service.js';
import type { UploadCompleteDto } from '#lib/shared/uploads.js';

/** Assembles the uploaded parts into one object once every part has arrived. */
export const POST = apiHandler(
	{ failure: 'Failed to finish the upload', params: ['id'] },
	async ({ db, ctx, event, params }): Promise<UploadCompleteDto> => {
		const bucket = event.platform?.env?.MEDIA_BUCKET;
		if (!bucket) throw new BindingUnavailableError('MEDIA_BUCKET');
		return new UploadService(db, bucket).complete(params.id!, ctx);
	}
);
