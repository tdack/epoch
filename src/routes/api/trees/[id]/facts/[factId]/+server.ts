import { expectedVersion, treeHandler } from '#lib/server/http/handler.js';
import { FactService } from '#lib/server/services/fact-service.js';
import { factUpdateSchema } from '#lib/server/validation/schemas.js';

export const PUT = treeHandler(
	{ failure: 'Failed to save the fact', params: ['factId'], body: factUpdateSchema },
	async ({ db, ctx, treeId, params, body: { version, ...fact } }) => {
		const { change } = await new FactService(db).update(treeId, params.factId, fact, version, ctx);
		return { change };
	}
);

export const DELETE = treeHandler(
	{ failure: 'Failed to remove the fact', params: ['factId'] },
	async ({ db, ctx, treeId, params, url }) => {
		const { change } = await new FactService(db).remove(
			treeId,
			params.factId,
			expectedVersion(url),
			ctx
		);
		return { change };
	}
);
