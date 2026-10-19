import { parseQuery } from './index';
import { fileListQuerySchema } from './schemas';

/** The files list's query as `MediaService.list` takes it, so `GET /api/files` and the pages that list files validate alike. */
export function parseFileListQuery(params: URLSearchParams) {
	const query = parseQuery(fileListQuerySchema, params);
	return {
		treeId: query.treeId,
		entityId: query.entityId,
		isDetachedOnly: query.owner === 'detached',
		cursor: query.cursor,
		limit: query.limit
	};
}
