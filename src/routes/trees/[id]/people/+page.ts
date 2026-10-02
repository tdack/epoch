import { DATA_KEY, rethrowAsPageError } from '#lib/services/load-helpers.js';
import { fetchList } from '#lib/services/tree-api.js';
import { INDIVIDUAL_SORTS, parseListParams, type IndividualListItem } from '#lib/shared/lists.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url, fetch, depends }) => {
	depends(DATA_KEY);
	const { offset, limit } = parseListParams(url.searchParams);
	const sort =
		url.searchParams.get('sort') === INDIVIDUAL_SORTS.GIVEN
			? INDIVIDUAL_SORTS.GIVEN
			: INDIVIDUAL_SORTS.SURNAME;
	const surname = url.searchParams.get('surname')?.trim() ?? '';
	try {
		const query = new URLSearchParams({ sort, offset: String(offset), limit: String(limit) });
		if (surname) query.set('surname', surname);
		return {
			sort,
			surname,
			page: await fetchList<IndividualListItem>(params.id, 'individuals', query, fetch)
		};
	} catch (cause) {
		rethrowAsPageError(cause);
	}
};
