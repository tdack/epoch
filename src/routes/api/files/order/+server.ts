import type { FileLinkResponse } from '#lib/shared/api-contracts.js';
import { apiHandler } from '#lib/server/http/handler.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { fileOrderSchema } from '#lib/server/validation/schemas.js';

/** Sets the order of the files shown on one record or fact, as one logged change. */
export const PUT = apiHandler(
	{ failure: 'Failed to reorder the files', body: fileOrderSchema },
	({ db, ctx, body }): Promise<FileLinkResponse> => new MediaService(db).reorderLinks(ctx, body)
);
