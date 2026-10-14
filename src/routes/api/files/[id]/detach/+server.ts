import { apiHandler } from '#lib/server/http/handler.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { fileDetachSchema } from '#lib/server/validation/schemas.js';

/** Detaches a file from its person or partnership. The file is kept, and is listed as unattached. */
export const POST = apiHandler(
	{ failure: 'Failed to detach the file', body: fileDetachSchema, params: ['id'] },
	({ db, ctx, params, body }) =>
		new MediaService(db).detach(ctx, {
			treeId: body.treeId,
			mediaId: params.id!,
			expectedVersion: body.version
		})
);
