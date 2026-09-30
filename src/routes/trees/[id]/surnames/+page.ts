import { DATA_KEY, rethrowAsPageError } from '#lib/services/load-helpers.js';
import { fetchList } from '#lib/services/tree-api.js';
import { parseListParams, type SurnameListItem } from '#lib/shared/lists.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url, fetch, depends }) => {
	depends(DATA_KEY);
	const { offset, limit } = parseListParams(url.searchParams);
	try {
		return { page: await fetchList<SurnameListItem>(params.id, 'surnames', new URLSearchParams({ offset: String(offset), limit: String(limit) }), fetch) };
	} catch (cause) {
		rethrowAsPageError(cause);
	}
};
