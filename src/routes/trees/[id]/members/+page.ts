import { DATA_KEY, rethrowAsPageError } from '#lib/services/load-helpers.js';
import { fetchMembers } from '#lib/services/tree-api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch, depends }) => {
	depends(DATA_KEY);
	try {
		return { members: await fetchMembers(params.id, fetch) };
	} catch (cause) {
		rethrowAsPageError(cause);
	}
};
