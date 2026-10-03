import { treeHandler } from '#lib/server/http/handler.js';
import { FactService } from '#lib/server/services/fact-service.js';
import { factCreateSchema } from '#lib/server/validation/schemas.js';

/** Add a fact to a person. Repeated and conflicting facts are welcome: nothing is matched by type. */
export const POST = treeHandler(
	{
		failure: 'Failed to add the fact',
		params: ['personId'],
		body: factCreateSchema,
		status: 201
	},
	async ({ db, ctx, treeId, params, body }) => {
		const { factId, change } = await new FactService(db).create(treeId, params.personId, body, ctx);
		return { factId, change };
	}
);
