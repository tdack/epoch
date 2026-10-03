import { treeHandler } from '#lib/server/http/handler.js';
import { EvidenceService } from '#lib/server/services/evidence-service.js';
import { sourceRepositoryLinkSchema } from '#lib/server/validation/schemas.js';

/** Say where a source is kept, with the call number it has there. */
export const POST = treeHandler(
	{
		failure: 'Failed to link the repository',
		params: ['sourceId'],
		body: sourceRepositoryLinkSchema,
		status: 201
	},
	async ({ db, ctx, treeId, params, body }) => {
		const { linkId, change } = await new EvidenceService(db).linkRepository(
			treeId,
			params.sourceId,
			body.repositoryId,
			body.callNumber,
			ctx
		);
		return { linkId, change };
	}
);
