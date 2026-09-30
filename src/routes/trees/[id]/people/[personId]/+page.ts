import { DATA_KEY, rethrowAsPageError } from '#lib/services/load-helpers.js';
import { fetchPersonPage } from '#lib/services/tree-api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch, depends }) => {
	depends(DATA_KEY);
	try {
		return { person: await fetchPersonPage(params.id, params.personId, fetch) };
	} catch (cause) {
		rethrowAsPageError(cause);
	}
};
