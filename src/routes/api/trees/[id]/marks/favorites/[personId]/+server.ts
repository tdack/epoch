import { treeHandler } from '#lib/server/http/handler.js';
import { MarkService } from '#lib/server/services/mark-service.js';

const options = { failure: 'Failed to change the favourite', params: ['personId'] };

/** Favourite a person. Idempotent. */
export const PUT = treeHandler(options, async ({ db, ctx, treeId, params }) => {
	const service = new MarkService(db);
	await service.addFavorite(treeId, params.personId, ctx);
	return service.get(treeId, ctx);
});

/** Remove a favourite. Idempotent: removing one that is not there is fine. */
export const DELETE = treeHandler(options, async ({ db, ctx, treeId, params }) => {
	const service = new MarkService(db);
	await service.removeFavorite(treeId, params.personId, ctx);
	return service.get(treeId, ctx);
});
