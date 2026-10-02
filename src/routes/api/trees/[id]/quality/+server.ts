import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { QualityService } from '#lib/server/services/quality-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { qualityDismissSchema } from '#lib/server/validation/schemas.js';
import { parseBody } from '#lib/server/validation/index.js';

function setup(params: { id?: string }, locals: App.Locals, platform: App.Platform | undefined) {
	if (!locals.user)
		return { fail: Response.json({ error: 'Authentication required' }, { status: 401 }) };
	if (!params.id) return { fail: Response.json({ error: 'Tree ID required' }, { status: 400 }) };
	if (!platform?.env?.DB)
		return { fail: Response.json({ error: 'Database binding unavailable' }, { status: 500 }) };
	return {
		treeId: params.id,
		service: new QualityService(getDb(platform.env.DB)),
		context: { user: locals.user, correlationId: locals.correlationId }
	};
}

/** The data-quality report: findings over what the caller may see, and the ones dismissed with a reason. */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	const s = setup(params, locals, platform);
	if (s.fail) return s.fail;
	try {
		return Response.json(await s.service.report(s.treeId, s.context));
	} catch (err) {
		return errorResponse(err, 'Failed to load the report');
	}
};

/** Dismiss a finding with a reason; dismissing again replaces the reason. */
export const PUT: RequestHandler = async ({ params, request, locals, platform }) => {
	const s = setup(params, locals, platform);
	if (s.fail) return s.fail;
	try {
		const { key, reason } = parseBody(qualityDismissSchema, await request.json().catch(() => ({})));
		await s.service.dismiss(s.treeId, key, reason, s.context);
		return Response.json({ ok: true });
	} catch (err) {
		return errorResponse(err, 'Failed to dismiss the finding');
	}
};

/** Bring a dismissed finding back: `?key=`. */
export const DELETE: RequestHandler = async ({ params, url, locals, platform }) => {
	const s = setup(params, locals, platform);
	if (s.fail) return s.fail;
	try {
		const key = url.searchParams.get('key');
		if (!key) return Response.json({ error: 'A finding key is required' }, { status: 400 });
		await s.service.restore(s.treeId, key, s.context);
		return Response.json({ ok: true });
	} catch (err) {
		return errorResponse(err, 'Failed to restore the finding');
	}
};
