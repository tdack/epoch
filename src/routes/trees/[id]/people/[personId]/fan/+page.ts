import { generationsParam, treeLoad } from '#lib/api/load-helpers.js';
import { fetchPedigree } from '#lib/api/lists.js';
import { MAX_FAN_GENERATIONS } from '#lib/charts/fan-layout.js';
import { DEFAULT_CHART_GENERATIONS } from '#lib/shared/charts.js';
import type { PageLoad } from './$types';

/** The depth lives in the address, as for the pedigree; a fan stops sooner, where its wedges get too narrow to read. */
export const load: PageLoad = treeLoad(async ({ params, url, fetch }) => {
	const generations = generationsParam(url, 'generations', {
		fallback: DEFAULT_CHART_GENERATIONS,
		max: MAX_FAN_GENERATIONS
	});
	return { chart: await fetchPedigree(params.id, params.personId, generations, fetch) };
});
