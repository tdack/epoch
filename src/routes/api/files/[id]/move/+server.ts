import { apiHandler } from '#lib/server/http/handler.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { fileAttachSchema } from '#lib/server/validation/schemas.js';

/** Moves an attached file to another person in the same tree, as one logged change. */
export const POST = apiHandler(
	{ failure: 'Failed to move the file', body: fileAttachSchema, params: ['id'] },
	({ db, ctx, params, body }) =>
		new MediaService(db).move(ctx, {
			treeId: body.treeId,
			mediaId: params.id!,
			entityId: body.entityId,
			expectedVersion: body.version
		})
);
