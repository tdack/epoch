import { BindingUnavailableError } from '#lib/server/domain/errors.js';
import { apiHandler } from '#lib/server/http/handler.js';
import { enforceRateLimit } from '#lib/server/http/rate-limit.js';
import { UploadService } from '#lib/server/services/upload-service.js';
import { uploadCreateSchema } from '#lib/server/validation/schemas.js';
import type { UploadSessionDto } from '#lib/shared/uploads.js';

/**
 * Opens a resumable upload. The client then PUTs each part to the URL given for it and calls
 * `complete`. An import counts against the import budget and a media file against the upload
 * budget, the same ones the form endpoints use, so a client cannot dodge a limit by switching path.
 */
export const POST = apiHandler(
	{ failure: 'Failed to start the upload', body: uploadCreateSchema, status: 201 },
	async ({ db, ctx, event, body }): Promise<UploadSessionDto> => {
		const bucket = event.platform?.env?.MEDIA_BUCKET;
		if (!bucket) throw new BindingUnavailableError('MEDIA_BUCKET');
		const service = new UploadService(db, bucket);
		// The role first, so a caller with no business here neither spends a token nor learns
		// whether the limiter is near its edge.
		await service.requireRole(body.treeId, body.purpose, ctx);
		const isImport = body.purpose === 'gedzip_import';
		await enforceRateLimit({
			binding: isImport
				? event.platform?.env?.IMPORT_RATE_LIMIT
				: event.platform?.env?.UPLOAD_RATE_LIMIT,
			bindingName: isImport ? 'IMPORT_RATE_LIMIT' : 'UPLOAD_RATE_LIMIT',
			key: ctx.user.id,
			message: isImport
				? 'Too many imports; try again in a minute'
				: 'Too many uploads; try again in a minute'
		});
		return service.create(body, ctx);
	}
);
