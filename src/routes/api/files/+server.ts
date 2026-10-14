import { apiHandler } from '#lib/server/http/handler.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { fileListQuerySchema } from '#lib/server/validation/schemas.js';

/**
 * A page of the files the caller may see across every tree they belong to, newest first, narrowed
 * by `?treeId=` and paged by `?cursor=` (from the last page's `nextCursor`). A page can be short or
 * empty for a restricted viewer while `nextCursor` is still set.
 */
export const GET = apiHandler(
	{ failure: 'Failed to list files', query: fileListQuerySchema },
	({ db, ctx, query }) => new MediaService(db).list(ctx, query)
);
