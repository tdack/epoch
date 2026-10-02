import { DATA_KEY, rethrowAsPageError } from '#lib/services/load-helpers.js';
import { fetchPersonPage, fetchRelationship } from '#lib/services/tree-api.js';
import type { PageLoad } from './$types';

/** The two people live in the address, so a refresh, the back button and a bookmark keep the question. */
export const load: PageLoad = async ({ params, url, fetch, depends }) => {
	depends(DATA_KEY);
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	try {
		if (!from || !to) {
			// A link from a person's page names only the first person; the picker needs their name.
			const named = from ? (await fetchPersonPage(params.id, from, fetch)).person : null;
			return { from, to, fromName: named?.displayName ?? null, result: null };
		}
		return {
			from,
			to,
			fromName: null,
			result: await fetchRelationship(params.id, from, to, fetch)
		};
	} catch (cause) {
		rethrowAsPageError(cause);
	}
};
