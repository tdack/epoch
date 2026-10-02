import { DATA_KEY, rethrowAsPageError } from '#lib/services/load-helpers.js';
import { fetchPlaces } from '#lib/services/tree-api.js';
import { parseListParams } from '#lib/shared/lists.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url, fetch, depends }) => {
	depends(DATA_KEY);
	const { offset, limit } = parseListParams(url.searchParams);
	const q = url.searchParams.get('q') ?? '';
	try {
		return {
			q,
			page: await fetchPlaces(
				params.id,
				new URLSearchParams({ q, offset: String(offset), limit: String(limit) }),
				fetch
			)
		};
	} catch (cause) {
		rethrowAsPageError(cause);
	}
};
