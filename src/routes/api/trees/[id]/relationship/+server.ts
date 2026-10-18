import { treeHandler } from '#lib/server/http/handler.js';
import { KinshipService } from '#lib/server/services/kinship-service.js';
import { ValidationError } from '#lib/server/domain/errors.js';

/** `?from=<person>&to=<person>`: every way the second is related to the first (see `RelationshipDto`). */
export const GET = treeHandler(
	{ allowPublicVisitor: true, failure: 'Failed to work out the relationship' },
	({ db, ctx, treeId, url }) => {
		const from = url.searchParams.get('from');
		const to = url.searchParams.get('to');
		if (!from || !to) throw new ValidationError('Both from and to are required');
		return new KinshipService(db).relationship(treeId, from, to, ctx);
	}
);
