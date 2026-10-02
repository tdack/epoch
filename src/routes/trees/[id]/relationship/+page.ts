import { DATA_KEY, rethrowAsPageError } from '#lib/services/load-helpers.js';
import { fetchRelationship } from '#lib/services/tree-api.js';
import type { PageLoad } from './$types';

/** The two people live in the address, so a refresh, the back button and a bookmark keep the question. */
export const load: PageLoad = async ({ params, url, fetch, depends }) => {
	depends(DATA_KEY);
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	if (!from || !to) return { from, to, result: null };
	try {
		return { from, to, result: await fetchRelationship(params.id, from, to, fetch) };
	} catch (cause) {
		rethrowAsPageError(cause);
	}
};
