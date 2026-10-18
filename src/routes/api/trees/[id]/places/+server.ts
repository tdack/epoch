import { treeHandler } from '#lib/server/http/handler.js';
import { PlaceService } from '#lib/server/services/place-service.js';
import { parseListParams } from '#lib/shared/lists.js';

/**
 * Places the tree's facts name, a page at a time: `?q=&offset=&limit=`, where `q` finds places
 * whose text contains it (the fact editor uses it for suggestions). `?name=` answers one place's
 * facts instead.
 */
export const GET = treeHandler(
	{ allowPublicVisitor: true, failure: 'Failed to list places' },
	({ db, ctx, treeId, subtree, url }) => {
		const service = new PlaceService(db);
		const page = parseListParams(url.searchParams);
		const lens = subtree?.rootPersonId ?? null;
		const name = url.searchParams.get('name');
		if (name) return service.detail(treeId, name, page, ctx, lens);
		return service.list(treeId, { q: url.searchParams.get('q') ?? '', ...page }, ctx, lens);
	}
);
