import { generationsParam, treeLoad } from '#lib/services/load-helpers.js';
import { fetchPedigree } from '#lib/services/tree-api.js';
import { DEFAULT_CHART_GENERATIONS } from '#lib/shared/charts.js';
import type { PageLoad } from './$types';

/** The depth lives in the address, so a refresh, the back button and a bookmark keep the chart. */
export const load: PageLoad = treeLoad(async ({ params, url, fetch }) => {
	const generations = generationsParam(url, 'generations', { fallback: DEFAULT_CHART_GENERATIONS });
	return { chart: await fetchPedigree(params.id, params.personId, generations, fetch) };
});
