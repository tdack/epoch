import { apiHandler } from '#lib/server/http/handler.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { fileRenameSchema } from '#lib/server/validation/schemas.js';

/** Renames one file in the tree named in the body. The change is logged and can be undone. */
export const PATCH = apiHandler(
	{ failure: 'Failed to rename the file', body: fileRenameSchema, params: ['id'] },
	({ db, ctx, params, body }) =>
		new MediaService(db).rename(ctx, {
			treeId: body.treeId,
			mediaId: params.id!,
			title: body.title,
			expectedVersion: body.version
		})
);
