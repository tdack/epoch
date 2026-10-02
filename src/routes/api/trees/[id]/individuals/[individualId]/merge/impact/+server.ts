import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { PersonMergeService } from '#lib/server/services/person-merge-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { personMergeSchema } from '#lib/server/validation/schemas.js';
import { parseBody } from '#lib/server/validation/index.js';

/**
 * The two records side by side, and, once nothing is left to choose and nothing refuses the pair,
 * exactly what the merge would write. Writes nothing.
 */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId, individualId } = params;
	if (!treeId || !individualId)
		return Response.json({ error: 'Tree ID and person ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const body = parseBody(personMergeSchema, await request.json().catch(() => ({})));
		const service = new PersonMergeService(getDb(platform.env.DB));
		const context = { user: locals.user, correlationId: locals.correlationId };
		const request_ = { survivorId: individualId, ...body };
		const review = await service.review(treeId, request_, context);
		const isPlannable = review.refusal === null && review.conflicts.length === 0;
		return Response.json({
			review,
			impact: isPlannable ? await service.preview(treeId, request_, context) : null
		});
	} catch (err) {
		return errorResponse(err, 'Failed to review the merge');
	}
};
