import { treeHandler } from '#lib/server/http/handler.js';
import { NameService } from '#lib/server/services/name-service.js';
import { namePreferredSchema } from '#lib/server/validation/schemas.js';

/** Choose which of a person's names is the one they are shown by. */
export const POST = treeHandler(
	{
		failure: 'Failed to choose the preferred name',
		params: ['personId'],
		body: namePreferredSchema
	},
	async ({ db, ctx, treeId, params, body: { nameId, version } }) => {
		const { change } = await new NameService(db).setPreferred(
			treeId,
			params.personId,
			nameId,
			version,
			ctx
		);
		return { change };
	}
);
