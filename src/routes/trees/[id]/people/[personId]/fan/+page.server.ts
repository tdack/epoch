import { generationsParam } from '#lib/api/load-helpers.js';
import { MAX_FAN_GENERATIONS } from '#lib/charts/fan-layout.js';
import { treeServerLoad } from '#lib/server/http/page-load.js';
import { ChartService } from '#lib/server/services/chart-service.js';
import { DEFAULT_CHART_GENERATIONS } from '#lib/shared/charts.js';
import type { PageServerLoad } from './$types';

/** The depth lives in the address, as for the pedigree; a fan stops sooner, where its wedges get too narrow to read. */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the chart', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { params, url }) => {
		const generations = generationsParam(url, 'generations', {
			fallback: DEFAULT_CHART_GENERATIONS,
			max: MAX_FAN_GENERATIONS
		});
		return {
			chart: await new ChartService(db).pedigree(treeId, params.personId, generations, ctx)
		};
	}
);
