import { treeHandler } from '#lib/server/http/handler.js';
import { KinshipService } from '#lib/server/services/kinship-service.js';

/** `?from=<person>&to=<person>`: every way the second is related to the first (see `RelationshipDto`). */
export const GET = treeHandler(
	{ failure: 'Failed to work out the relationship' },
	({ db, ctx, treeId, url }) => {
		const from = url.searchParams.get('from');
		const to = url.searchParams.get('to');
		if (!from || !to)
			return Response.json({ error: 'Both from and to are required' }, { status: 400 });
		return new KinshipService(db).relationship(treeId, from, to, ctx);
	}
);
