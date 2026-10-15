import { listQuery, treeLoad } from '#lib/api/load-helpers.js';
import { fetchList } from '#lib/api/lists.js';
import { INDIVIDUAL_SORTS, type IndividualListItem } from '#lib/shared/lists.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, url, fetch }) => {
	const sort =
		url.searchParams.get('sort') === INDIVIDUAL_SORTS.GIVEN
			? INDIVIDUAL_SORTS.GIVEN
			: INDIVIDUAL_SORTS.SURNAME;
	const surname = url.searchParams.get('surname')?.trim() ?? '';
	const query = listQuery(url, { sort });
	if (surname) query.set('surname', surname);
	return {
		sort,
		surname,
		page: await fetchList<IndividualListItem>(params.id, 'individuals', query, fetch)
	};
});
