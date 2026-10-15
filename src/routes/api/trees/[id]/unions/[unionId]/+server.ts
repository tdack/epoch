import { treeHandler } from '#lib/server/http/handler.js';
import { RelationshipService } from '#lib/server/services/relationship-service.js';
import { UnionPageService } from '#lib/server/services/union-page-service.js';
import { unionUpdateSchema } from '#lib/server/validation/schemas.js';

/** Edit a partnership's status and events (marriage, engagement, separation, divorce, annulment). */
export const PUT = treeHandler(
	{ failure: 'Failed to update union', params: ['unionId'], body: unionUpdateSchema },
	async ({ db, ctx, treeId, params, body: { version, status, events } }) => {
		const { change } = await new RelationshipService(db).updateUnion(
			treeId,
			{ kind: 'update_union', unionId: params.unionId, expectedVersion: version, status, events },
			ctx
		);
		return { change };
	}
);

/** Everything the partnership page shows, from bounded reads: see `UnionPageDto`. */
export const GET = treeHandler(
	{ allowPublicVisitor: true, failure: 'Failed to load the partnership', params: ['unionId'] },
	({ db, ctx, treeId, params }) => new UnionPageService(db).getUnion(treeId, params.unionId, ctx)
);
