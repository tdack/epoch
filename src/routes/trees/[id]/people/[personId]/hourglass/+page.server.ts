import { generationsParam } from '#lib/api/load-helpers.js';
import { treeServerLoad } from '#lib/server/http/page-load.js';
import { ChartService } from '#lib/server/services/chart-service.js';
import { DEFAULT_CHART_GENERATIONS, MAX_HOURGLASS_GENERATIONS } from '#lib/shared/charts.js';
import type { PageServerLoad } from './$types';

const DEPTH = { fallback: DEFAULT_CHART_GENERATIONS - 1, max: MAX_HOURGLASS_GENERATIONS };

/**
 * Both halves come from the two chart reads, each privacy-masked on its own, so an hourglass
 * shows exactly what the ancestors and descendants charts show side by side. The depths live in the
 * address as `up` and `down`.
 */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the chart', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { params, url }) => {
		const up = generationsParam(url, 'up', DEPTH);
		const down = generationsParam(url, 'down', DEPTH);
		const charts = new ChartService(db);
		const [ancestors, descendants] = await Promise.all([
			charts.pedigree(treeId, params.personId, up, ctx),
			charts.descendants(treeId, params.personId, down, ctx)
		]);
		return { ancestors, descendants, up, down };
	}
);
