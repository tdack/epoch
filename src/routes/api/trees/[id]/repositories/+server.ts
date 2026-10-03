import { treeHandler } from '#lib/server/http/handler.js';
import { EvidenceService } from '#lib/server/services/evidence-service.js';
import { repositoryCreateSchema } from '#lib/server/validation/schemas.js';

/** Make a repository: an archive, library or website that holds sources. */
export const POST = treeHandler(
	{ failure: 'Failed to add the repository', body: repositoryCreateSchema, status: 201 },
	async ({ db, ctx, treeId, body }) => {
		const { repositoryId, change } = await new EvidenceService(db).createRepository(
			treeId,
			body,
			ctx
		);
		return { repositoryId, change };
	}
);
