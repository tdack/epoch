import { treeHandler } from '#lib/server/http/handler.js';
import { NameService } from '#lib/server/services/name-service.js';
import { nameReorderSchema } from '#lib/server/validation/schemas.js';

export const POST = treeHandler(
	{ failure: 'Failed to reorder the names', params: ['personId'], body: nameReorderSchema },
	async ({ db, ctx, treeId, params, body: { orderedNameIds } }) => {
		const { change } = await new NameService(db).reorder(
			treeId,
			params.personId,
			orderedNameIds,
			ctx
		);
		return { change };
	}
);
