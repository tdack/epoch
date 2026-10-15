import { treeHandler } from '#lib/server/http/handler.js';
import { RelationshipService } from '#lib/server/services/relationship-service.js';
import { relationshipPayloadSchema } from '#lib/server/validation/schemas.js';

export const POST = treeHandler(
	{ failure: 'Failed to apply relationship command', body: relationshipPayloadSchema },
	async ({ db, ctx, treeId, body: { intent } }) => {
		const { change, affected, ...plan } = await new RelationshipService(db).execute(
			treeId,
			intent,
			ctx
		);
		// 200 rather than 201 when the plan wrote nothing (a warning stopped it), so the client can say so.
		return Response.json({ plan, change, affected }, { status: change ? 201 : 200 });
	}
);
