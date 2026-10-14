import { apiHandler } from '#lib/server/http/handler.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { fileAttachSchema } from '#lib/server/validation/schemas.js';

/** Attaches a detached file to a person or partnership in the same tree. */
export const POST = apiHandler(
	{ failure: 'Failed to attach the file', body: fileAttachSchema, params: ['id'] },
	({ db, ctx, params, body }) =>
		new MediaService(db).attach(ctx, {
			treeId: body.treeId,
			mediaId: params.id!,
			entityId: body.entityId,
			expectedVersion: body.version
		})
);
