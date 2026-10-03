import { treeHandler } from '#lib/server/http/handler.js';
import { FactService } from '#lib/server/services/fact-service.js';
import { factReorderSchema } from '#lib/server/validation/schemas.js';

export const POST = treeHandler(
	{ failure: 'Failed to reorder the facts', params: ['personId'], body: factReorderSchema },
	async ({ db, ctx, treeId, params, body: { orderedFactIds } }) => {
		const { change } = await new FactService(db).reorder(
			treeId,
			params.personId,
			orderedFactIds,
			ctx
		);
		return { change };
	}
);
