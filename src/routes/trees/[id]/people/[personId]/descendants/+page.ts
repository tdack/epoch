import { DATA_KEY, rethrowAsPageError } from '#lib/services/load-helpers.js';
import { fetchDescendants } from '#lib/services/tree-api.js';
import { DEFAULT_CHART_GENERATIONS } from '#lib/shared/charts.js';
import type { PageLoad } from './$types';

/** The depth lives in the address, so a refresh, the back button and a bookmark keep the chart. */
export const load: PageLoad = async ({ params, url, fetch, depends }) => {
	depends(DATA_KEY);
	const asked = Number(url.searchParams.get('generations'));
	const generations = Number.isInteger(asked) && asked > 0 ? asked : DEFAULT_CHART_GENERATIONS;
	try {
		return { chart: await fetchDescendants(params.id, params.personId, generations, fetch) };
	} catch (cause) {
		rethrowAsPageError(cause);
	}
};
