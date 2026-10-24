import { apiHandler } from '#lib/server/http/handler.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { fileLinkSchema } from '#lib/server/validation/schemas.js';

/** Links a file to a person, partnership or source in the same tree. A file can have many links. */
export const POST = apiHandler(
	{ failure: 'Failed to link the file', body: fileLinkSchema, params: ['id'] },
	({ db, ctx, params, body }) =>
		new MediaService(db).link(ctx, {
			treeId: body.treeId,
			mediaId: params.id!,
			entityId: body.entityId,
			expectedVersion: body.version
		})
);
