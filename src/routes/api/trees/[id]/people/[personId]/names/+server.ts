import { treeHandler } from '#lib/server/http/handler.js';
import { NameService } from '#lib/server/services/name-service.js';
import { citationAttachSchema, nameCreateSchema } from '#lib/server/validation/schemas.js';

/** Add a name to a person. */
export const POST = treeHandler(
	{
		failure: 'Failed to add the name',
		params: ['personId'],
		body: nameCreateSchema.extend({ citation: citationAttachSchema.optional() }),
		status: 201
	},
	async ({ db, ctx, treeId, params, body: { isPreferred, citation, ...name } }) => {
		const { nameId, change } = await new NameService(db).create(
			treeId,
			params.personId,
			name as never,
			isPreferred,
			ctx,
			citation
		);
		return { nameId, change };
	}
);
