import { apiHandler } from '#lib/server/http/handler.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { fileUnlinkQuerySchema } from '#lib/server/validation/schemas.js';

/** Unlinks a file from one record. The file is kept, and is listed as unlinked once it has no links. */
export const DELETE = apiHandler(
	{
		failure: 'Failed to unlink the file',
		query: fileUnlinkQuerySchema,
		params: ['id', 'entityId']
	},
	({ db, ctx, params, query }) =>
		new MediaService(db).unlink(ctx, {
			treeId: query.treeId,
			mediaId: params.id!,
			entityId: params.entityId!,
			expectedVersion: query.version
		})
);
