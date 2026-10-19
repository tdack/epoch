import { apiHandler } from '#lib/server/http/handler.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { parseFileListQuery } from '#lib/server/validation/file-query.js';

/**
 * A page of the files the caller may see across every tree they belong to, newest first, narrowed
 * by `?treeId=` and paged by `?cursor=` (from the last page's `nextCursor`). A page can be short or
 * empty for a restricted viewer while `nextCursor` is still set.
 */
export const GET = apiHandler({ failure: 'Failed to list files' }, ({ db, ctx, url }) =>
	new MediaService(db).list(ctx, parseFileListQuery(url.searchParams))
);
