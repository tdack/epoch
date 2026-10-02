import { DATA_KEY, rethrowAsPageError } from '#lib/services/load-helpers.js';
import { fetchQuality } from '#lib/services/tree-api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch, depends }) => {
	depends(DATA_KEY);
	try {
		return { report: await fetchQuality(params.id, fetch) };
	} catch (cause) {
		rethrowAsPageError(cause);
	}
};
