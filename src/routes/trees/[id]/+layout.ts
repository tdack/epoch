import { fetchTreeList, fetchTreeSummary } from '#lib/services/tree-api.js';
import { DATA_KEY, rethrowAsPageError } from '#lib/services/load-helpers.js';
import type { LayoutLoad } from './$types';

/** What every screen under a tree needs for the header: the tree list, and this tree's name and counts. */
export const load: LayoutLoad = async ({ params, fetch, depends }) => {
	depends(DATA_KEY);
	try {
		const [trees, summary] = await Promise.all([fetchTreeList(fetch), fetchTreeSummary(params.id, fetch)]);
		return { trees, summary };
	} catch (cause) {
		rethrowAsPageError(cause);
	}
};
