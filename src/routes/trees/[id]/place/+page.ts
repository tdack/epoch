import { DATA_KEY, rethrowAsPageError } from '#lib/services/load-helpers.js';
import { fetchPlace } from '#lib/services/tree-api.js';
import { parseListParams } from '#lib/shared/lists.js';
import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** The place is in the address as `?name=`, the text of the place as it is written on its facts. */
export const load: PageLoad = async ({ params, url, fetch, depends }) => {
	depends(DATA_KEY);
	const name = url.searchParams.get('name');
	if (!name) error(404, 'Place not found');
	const { offset, limit } = parseListParams(url.searchParams);
	try {
		return { place: await fetchPlace(params.id, name, new URLSearchParams({ offset: String(offset), limit: String(limit) }), fetch) };
	} catch (cause) {
		rethrowAsPageError(cause);
	}
};
