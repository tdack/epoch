import { generationsParam, treeLoad } from '#lib/services/load-helpers.js';
import { fetchDescendants, fetchPedigree } from '#lib/services/tree-api.js';
import { DEFAULT_CHART_GENERATIONS, MAX_HOURGLASS_GENERATIONS } from '#lib/shared/charts.js';
import type { PageLoad } from './$types';

const DEPTH = { fallback: DEFAULT_CHART_GENERATIONS - 1, max: MAX_HOURGLASS_GENERATIONS };

/**
 * Both halves come from the two chart endpoints, each privacy-masked on its own, so an hourglass
 * shows exactly what the ancestors and descendants charts show side by side. The depths live in the
 * address as `up` and `down`.
 */
export const load: PageLoad = treeLoad(async ({ params, url, fetch }) => {
	const up = generationsParam(url, 'up', DEPTH);
	const down = generationsParam(url, 'down', DEPTH);
	const [ancestors, descendants] = await Promise.all([
		fetchPedigree(params.id, params.personId, up, fetch),
		fetchDescendants(params.id, params.personId, down, fetch)
	]);
	return { ancestors, descendants, up, down };
});
