import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { ChartService } from '#lib/server/services/chart-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { DEFAULT_CHART_GENERATIONS } from '#lib/shared/charts.js';

/** `?person=<id>&generations=<n>`: the descendants chart's data (see `DescendantsDto`). */
export const GET: RequestHandler = async ({ params, url, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const treeId = params.id;
	if (!treeId) return Response.json({ error: 'Tree ID required' }, { status: 400 });
	if (!platform?.env?.DB) return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
	const person = url.searchParams.get('person');
	if (!person) return Response.json({ error: 'person is required' }, { status: 400 });
	const generations = Number(url.searchParams.get('generations') ?? DEFAULT_CHART_GENERATIONS);

	try {
		return Response.json(await new ChartService(getDb(platform.env.DB)).descendants(treeId, person, generations, { user: locals.user, correlationId: locals.correlationId }));
	} catch (err) {
		return errorResponse(err, 'Failed to load the chart');
	}
};
