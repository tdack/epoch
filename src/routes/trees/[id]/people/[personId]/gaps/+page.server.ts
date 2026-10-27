import { generationsParam } from '#lib/api/load-helpers.js';
import { treeServerLoad } from '#lib/server/http/page-load.js';
import { ChartService } from '#lib/server/services/chart-service.js';
import { MAX_PEDIGREE_GENERATIONS } from '#lib/shared/charts.js';
import type { PageServerLoad } from './$types';

/** Five generations reach the great-great-grandparents, where most trees start to thin. */
const DEFAULT_GAP_GENERATIONS = 5;

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the research gaps', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { params, url }) => ({
		chart: await new ChartService(db).pedigree(
			treeId,
			params.personId,
			generationsParam(url, 'generations', {
				fallback: DEFAULT_GAP_GENERATIONS,
				max: MAX_PEDIGREE_GENERATIONS
			}),
			ctx
		)
	})
);
