import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { PrivacyService } from '#lib/server/services/privacy-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { parseBody } from '#lib/server/validation/index.js';
import { personPrivacySchema } from '#lib/server/validation/schemas.js';

/** Force a person public or private, or hand them back to the derived living state. A manager's action. */
export const PUT: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId, personId } = params;
	if (!treeId || !personId)
		return Response.json({ error: 'Tree ID and person ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const { privacy, version } = parseBody(
			personPrivacySchema,
			await request.json().catch(() => ({}))
		);
		const service = new PrivacyService(getDb(platform.env.DB));
		const { change } = await service.setPersonPrivacy(treeId, personId, privacy, version, {
			user: locals.user,
			correlationId: locals.correlationId
		});
		return Response.json({ change });
	} catch (err) {
		return errorResponse(err, 'Failed to change the privacy of the person');
	}
};
