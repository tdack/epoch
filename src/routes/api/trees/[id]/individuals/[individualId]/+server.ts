import { expectedVersion, treeHandler } from '#lib/server/http/handler.js';
import { GenealogyService } from '#lib/server/services/genealogy-service.js';
import { individualUpdateSchema } from '#lib/server/validation/schemas.js';

export const GET = treeHandler(
	{ failure: 'Failed to get individual', params: ['individualId'] },
	async ({ db, ctx, treeId, params }) => ({
		individual: await new GenealogyService(db).getIndividual(treeId, params.individualId, ctx)
	})
);

export const PUT = treeHandler(
	{
		failure: 'Failed to update individual',
		params: ['individualId'],
		body: individualUpdateSchema
	},
	async ({ db, ctx, treeId, params, body }) => {
		const { givenName, surname, sex, birthDate, birthPlace, deathDate, deathPlace, version } = body;
		const { individual, change } = await new GenealogyService(db).updateIndividual(
			treeId,
			params.individualId,
			version,
			{ givenName, surname, sex, birthDate, birthPlace, deathDate, deathPlace },
			ctx
		);
		return { success: true, individual, change };
	}
);

export const DELETE = treeHandler(
	{ failure: 'Failed to delete individual', params: ['individualId'] },
	async ({ db, ctx, treeId, params, url }) => {
		const { change } = await new GenealogyService(db).deleteIndividual(
			treeId,
			params.individualId,
			ctx,
			expectedVersion(url)
		);
		return { success: true, change };
	}
);
