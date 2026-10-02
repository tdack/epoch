import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { PrivacyService } from '#lib/server/services/privacy-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { parseBody } from '#lib/server/validation/index.js';
import { privacySettingsSchema } from '#lib/server/validation/schemas.js';

/** The tree's privacy settings: how old a birth makes someone not living, and whether private people show as placeholders. */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const treeId = params.id;
	if (!treeId) return Response.json({ error: 'Tree ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const service = new PrivacyService(getDb(platform.env.DB));
		return Response.json(
			await service.getSettings(treeId, { user: locals.user, correlationId: locals.correlationId })
		);
	} catch (err) {
		return errorResponse(err, 'Failed to read the privacy settings');
	}
};

export const PUT: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const treeId = params.id;
	if (!treeId) return Response.json({ error: 'Tree ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const patch = parseBody(privacySettingsSchema, await request.json().catch(() => ({})));
		const service = new PrivacyService(getDb(platform.env.DB));
		return Response.json(
			await service.updateSettings(treeId, patch, {
				user: locals.user,
				correlationId: locals.correlationId
			})
		);
	} catch (err) {
		return errorResponse(err, 'Failed to save the privacy settings');
	}
};
