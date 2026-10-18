import { apiHandler } from '#lib/server/http/handler.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { fileTreeQuerySchema } from '#lib/server/validation/schemas.js';
import { BindingUnavailableError } from '#lib/server/domain/errors.js';

/**
 * Stored objects that no file points at, in the trees the caller manages. Objects uploaded within
 * the last hour are left out: an upload writes its bytes before its row.
 */
export const GET = apiHandler(
	{ failure: 'Failed to list unlinked files', query: fileTreeQuerySchema },
	({ db, ctx, event, query }) => {
		const bucket = event.platform?.env?.MEDIA_BUCKET;
		if (!bucket) throw new BindingUnavailableError('MEDIA_BUCKET');
		return new MediaService(db).listUnlinked(ctx, bucket, query.treeId);
	}
);

/** Deletes the unlinked objects a fresh listing finds, in the trees the caller manages. Irreversible. */
export const DELETE = apiHandler(
	{ failure: 'Failed to delete unlinked files', query: fileTreeQuerySchema },
	({ db, ctx, event, query }) => {
		const bucket = event.platform?.env?.MEDIA_BUCKET;
		if (!bucket) throw new BindingUnavailableError('MEDIA_BUCKET');
		return new MediaService(db).deleteUnlinked(ctx, bucket, query.treeId);
	}
);
