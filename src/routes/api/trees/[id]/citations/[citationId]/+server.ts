import { expectedVersion, treeHandler } from '#lib/server/http/handler.js';
import { EvidenceService } from '#lib/server/services/evidence-service.js';
import { citationUpdateSchema } from '#lib/server/validation/schemas.js';

export const PUT = treeHandler(
	{ failure: 'Failed to save the citation', params: ['citationId'], body: citationUpdateSchema },
	async ({ db, ctx, treeId, params, body: { version, ...citation } }) => {
		const { change } = await new EvidenceService(db).updateCitation(
			treeId,
			params.citationId,
			citation,
			version,
			ctx
		);
		return { change };
	}
);

export const DELETE = treeHandler(
	{ failure: 'Failed to remove the citation', params: ['citationId'] },
	async ({ db, ctx, treeId, params, url }) => {
		const { change } = await new EvidenceService(db).removeCitation(
			treeId,
			params.citationId,
			expectedVersion(url),
			ctx
		);
		return { change };
	}
);
