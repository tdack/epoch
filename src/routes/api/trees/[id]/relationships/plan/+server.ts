import { treeHandler } from '#lib/server/http/handler.js';
import { RelationshipService } from '#lib/server/services/relationship-service.js';
import { relationshipPayloadSchema } from '#lib/server/validation/schemas.js';

export const POST = treeHandler(
	{ failure: 'Failed to plan relationship command', body: relationshipPayloadSchema },
	async ({ db, ctx, treeId, body: { intent } }) => ({
		plan: await new RelationshipService(db).plan(treeId, intent, ctx)
	})
);
