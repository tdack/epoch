import { treeHandler } from '#lib/server/http/handler.js';
import { RelationshipService } from '#lib/server/services/relationship-service.js';
import { relationshipDeleteSchema } from '#lib/server/validation/schemas.js';

/**
 * Delete a specific relationship edge or union (never a person). Accepts
 * `remove_parent_child`, `remove_partner_from_union`, and `destroy_union`. Callers show the
 * impact endpoint's preview first.
 */
export const POST = treeHandler(
	{ failure: 'Failed to remove relationship', body: relationshipDeleteSchema },
	async ({ db, ctx, treeId, body }) => {
		const { change } = await new RelationshipService(db).removeRelationship(treeId, body, ctx);
		return { change };
	}
);
