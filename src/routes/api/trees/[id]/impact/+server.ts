import type { ImpactResponse, TreeImpactResponse } from '#lib/shared/api-contracts.js';
import { treeHandler } from '#lib/server/http/handler.js';
import { PersonService } from '#lib/server/services/person-service.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import { RelationshipService } from '#lib/server/services/relationship-service.js';
import { impactRequestSchema } from '#lib/server/validation/schemas.js';

/**
 * Preview a destructive action without doing it: the exact people, partnerships, links and events
 * it would delete or change. The UI shows this before asking for confirmation.
 */
export const POST = treeHandler(
	{ failure: 'Failed to preview impact', body: impactRequestSchema },
	async ({ db, ctx, treeId, body }): Promise<TreeImpactResponse | ImpactResponse> => {
		if (body.kind === 'delete_tree') {
			return { treeImpact: await new TreeService(db).previewDeleteTree(treeId, ctx) };
		}
		if (body.kind === 'delete_person') {
			return {
				impact: await new PersonService(db).previewDelete(treeId, body.personId, ctx)
			};
		}
		return { impact: await new RelationshipService(db).previewRemoval(treeId, body, ctx) };
	}
);
