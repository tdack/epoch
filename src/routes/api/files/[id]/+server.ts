import { apiHandler } from '#lib/server/http/handler.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { fileDeleteQuerySchema, fileRenameSchema } from '#lib/server/validation/schemas.js';
import { BindingUnavailableError } from '#lib/server/domain/errors.js';

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

/**
 * Deletes one file, row and bytes. Not logged, so it cannot be undone. `wasObjectRemoved` is false when
 * the bytes could not be removed; the row is gone either way and the bytes are then found as unlinked.
 */
export const DELETE = apiHandler(
	{ failure: 'Failed to delete the file', query: fileDeleteQuerySchema, params: ['id'] },
	({ db, ctx, event, params, query }) => {
		const bucket = event.platform?.env?.MEDIA_BUCKET;
		if (!bucket) throw new BindingUnavailableError('MEDIA_BUCKET');
		return new MediaService(db).delete(ctx, { treeId: query.treeId, mediaId: params.id! }, bucket);
	}
);
