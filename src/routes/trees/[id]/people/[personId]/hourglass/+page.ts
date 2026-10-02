import { DATA_KEY, rethrowAsPageError } from '#lib/services/load-helpers.js';
import { fetchDescendants, fetchPedigree } from '#lib/services/tree-api.js';
import { DEFAULT_CHART_GENERATIONS, MAX_HOURGLASS_GENERATIONS } from '#lib/shared/charts.js';
import type { PageLoad } from './$types';

const depth = (value: string | null) => {
	const asked = Number(value);
	return Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_HOURGLASS_GENERATIONS) : DEFAULT_CHART_GENERATIONS - 1;
};

/**
 * Both halves come from the two chart endpoints, each privacy-masked on its own, so an hourglass
 * shows exactly what the ancestors and descendants charts show side by side. The depths live in the
 * address as `up` and `down`.
 */
export const load: PageLoad = async ({ params, url, fetch, depends }) => {
	depends(DATA_KEY);
	const up = depth(url.searchParams.get('up'));
	const down = depth(url.searchParams.get('down'));
	try {
		const [ancestors, descendants] = await Promise.all([
			fetchPedigree(params.id, params.personId, up, fetch),
			fetchDescendants(params.id, params.personId, down, fetch)
		]);
		return { ancestors, descendants, up, down };
	} catch (cause) {
		rethrowAsPageError(cause);
	}
};
