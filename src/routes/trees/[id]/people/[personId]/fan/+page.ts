import { DATA_KEY, rethrowAsPageError } from '#lib/services/load-helpers.js';
import { fetchPedigree } from '#lib/services/tree-api.js';
import { MAX_FAN_GENERATIONS } from '#lib/charts/fan-layout.js';
import { DEFAULT_CHART_GENERATIONS } from '#lib/shared/charts.js';
import type { PageLoad } from './$types';

/** The depth lives in the address, as for the pedigree; a fan stops sooner, where its wedges get too narrow to read. */
export const load: PageLoad = async ({ params, url, fetch, depends }) => {
	depends(DATA_KEY);
	const asked = Number(url.searchParams.get('generations'));
	const generations = Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_FAN_GENERATIONS) : DEFAULT_CHART_GENERATIONS;
	try {
		return { chart: await fetchPedigree(params.id, params.personId, generations, fetch) };
	} catch (cause) {
		rethrowAsPageError(cause);
	}
};
