import { BindingUnavailableError, ValidationError } from '#lib/server/domain/errors.js';
import { fixedLengthBody } from '#lib/server/http/fixed-length-body.js';
import { apiHandler } from '#lib/server/http/handler.js';
import { UploadService } from '#lib/server/services/upload-service.js';
import type { UploadPartDto } from '#lib/shared/uploads.js';

/** The header as a whole number of bytes, or null when it is absent or not one. */
function contentLengthOf(request: Request): number | null {
	const raw = request.headers.get('content-length');
	if (raw === null || !/^\d+$/.test(raw)) return null;
	const value = Number(raw);
	return Number.isSafeInteger(value) ? value : null;
}

/**
 * Streams one part into R2. No `body` schema is declared, so the handler's JSON size cap does not
 * apply and the body is never read here: it goes straight to R2 through a stream sized from
 * `Content-Length`. Sending the same part again replaces it.
 */
export const PUT = apiHandler(
	{ failure: 'Failed to upload the part', params: ['id', 'n'] },
	async ({ db, ctx, event, params }): Promise<UploadPartDto> => {
		const bucket = event.platform?.env?.MEDIA_BUCKET;
		if (!bucket) throw new BindingUnavailableError('MEDIA_BUCKET');
		if (!/^\d+$/.test(params.n!)) throw new ValidationError('The part number must be a number');
		const length = contentLengthOf(event.request);
		const body = event.request.body;
		return new UploadService(db, bucket).putPart(
			params.id!,
			Number(params.n),
			length,
			// The service compares `length` with the part's expected size before reading a byte, so a
			// wrong one never reaches R2; the wrapper then makes the runtime enforce it.
			body && length !== null ? fixedLengthBody(body, length) : null,
			ctx
		);
	}
);
