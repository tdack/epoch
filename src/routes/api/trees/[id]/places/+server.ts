import { treeHandler } from '#lib/server/http/handler.js';
import { PlaceService } from '#lib/server/services/place-service.js';
import { parseListParams } from '#lib/shared/lists.js';

/**
 * Places the tree's facts name, a page at a time: `?q=&offset=&limit=`, where `q` finds places
 * whose text contains it (the fact editor uses it for suggestions). `?name=` answers one place's
 * facts instead.
 */
export const GET = treeHandler({ failure: 'Failed to list places' }, ({ db, ctx, treeId, url }) => {
	const service = new PlaceService(db);
	const page = parseListParams(url.searchParams);
	const name = url.searchParams.get('name');
	if (name) return service.detail(treeId, name, page, ctx);
	return service.list(treeId, { q: url.searchParams.get('q') ?? '', ...page }, ctx);
});
