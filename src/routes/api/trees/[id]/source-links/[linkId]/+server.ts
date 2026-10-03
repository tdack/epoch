import { expectedVersion, treeHandler } from '#lib/server/http/handler.js';
import { EvidenceService } from '#lib/server/services/evidence-service.js';
import { sourceRepositoryUpdateSchema } from '#lib/server/validation/schemas.js';

export const PUT = treeHandler(
	{
		failure: 'Failed to save the call number',
		params: ['linkId'],
		body: sourceRepositoryUpdateSchema
	},
	async ({ db, ctx, treeId, params, body }) => {
		const { change } = await new EvidenceService(db).updateSourceRepository(
			treeId,
			params.linkId,
			body.callNumber,
			body.version,
			ctx
		);
		return { change };
	}
);

export const DELETE = treeHandler(
	{ failure: 'Failed to unlink the repository', params: ['linkId'] },
	async ({ db, ctx, treeId, params, url }) => {
		const { change } = await new EvidenceService(db).unlinkRepository(
			treeId,
			params.linkId,
			expectedVersion(url),
			ctx
		);
		return { change };
	}
);
