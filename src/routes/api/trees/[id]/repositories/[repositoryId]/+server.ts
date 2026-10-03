import { expectedVersion, treeHandler } from '#lib/server/http/handler.js';
import { EvidenceService } from '#lib/server/services/evidence-service.js';
import { repositoryUpdateSchema } from '#lib/server/validation/schemas.js';

export const PUT = treeHandler(
	{
		failure: 'Failed to save the repository',
		params: ['repositoryId'],
		body: repositoryUpdateSchema
	},
	async ({ db, ctx, treeId, params, body: { version, ...repository } }) => {
		const { change } = await new EvidenceService(db).updateRepository(
			treeId,
			params.repositoryId,
			repository,
			version,
			ctx
		);
		return { change };
	}
);

/** Delete a repository. Sources that were kept there lose the link; their citations are untouched. */
export const DELETE = treeHandler(
	{ failure: 'Failed to delete the repository', params: ['repositoryId'] },
	async ({ db, ctx, treeId, params, url }) => {
		const { change } = await new EvidenceService(db).deleteRepository(
			treeId,
			params.repositoryId,
			expectedVersion(url),
			ctx
		);
		return { change };
	}
);
