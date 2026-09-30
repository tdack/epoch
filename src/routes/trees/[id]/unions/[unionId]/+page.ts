import { DATA_KEY, rethrowAsPageError } from '#lib/services/load-helpers.js';
import { fetchUnionPage } from '#lib/services/tree-api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch, depends }) => {
	depends(DATA_KEY);
	try {
		return { union: await fetchUnionPage(params.id, params.unionId, fetch) };
	} catch (cause) {
		rethrowAsPageError(cause);
	}
};
