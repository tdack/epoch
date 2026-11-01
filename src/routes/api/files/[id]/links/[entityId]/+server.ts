import { apiHandler } from '#lib/server/http/handler.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { fileLinkUpdateSchema, fileUnlinkQuerySchema } from '#lib/server/validation/schemas.js';

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
			factId: query.factId,
			expectedVersion: query.version
		})
);

/** Sets or clears the title that overrides the file's for this record or fact (`TITL` on the pointer). */
export const PATCH = apiHandler(
	{
		failure: 'Failed to edit the link',
		body: fileLinkUpdateSchema,
		params: ['id', 'entityId']
	},
	({ db, ctx, params, body }) =>
		new MediaService(db).updateLink(ctx, {
			treeId: body.treeId,
			mediaId: params.id!,
			entityId: params.entityId!,
			factId: body.factId,
			title: body.title,
			expectedVersion: body.version
		})
);
