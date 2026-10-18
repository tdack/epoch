import { expectedVersion, treeHandler } from '#lib/server/http/handler.js';
import { NameService } from '#lib/server/services/name-service.js';
import { citationAttachSchema, nameUpdateSchema } from '#lib/server/validation/schemas.js';

export const PUT = treeHandler(
	{
		failure: 'Failed to save the name',
		params: ['nameId'],
		body: nameUpdateSchema.extend({ citation: citationAttachSchema.optional() })
	},
	async ({ db, ctx, treeId, params, body: { version, citation, ...name } }) => {
		const { change } = await new NameService(db).update(
			treeId,
			params.nameId,
			name as never,
			version,
			ctx,
			citation
		);
		return { change };
	}
);

export const DELETE = treeHandler(
	{ failure: 'Failed to remove the name', params: ['nameId'] },
	async ({ db, ctx, treeId, params, url }) => {
		const { change } = await new NameService(db).remove(
			treeId,
			params.nameId,
			expectedVersion(url),
			ctx
		);
		return { change };
	}
);
