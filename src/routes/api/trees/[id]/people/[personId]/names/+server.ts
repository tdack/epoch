import { treeHandler } from '#lib/server/http/handler.js';
import { NameService } from '#lib/server/services/name-service.js';
import { nameCreateSchema } from '#lib/server/validation/schemas.js';

/** Add a name to a person. */
export const POST = treeHandler(
	{
		failure: 'Failed to add the name',
		params: ['personId'],
		body: nameCreateSchema,
		status: 201
	},
	async ({ db, ctx, treeId, params, body: { isPreferred, ...name } }) => {
		const { nameId, change } = await new NameService(db).create(
			treeId,
			params.personId,
			name as never,
			isPreferred,
			ctx
		);
		return { nameId, change };
	}
);
