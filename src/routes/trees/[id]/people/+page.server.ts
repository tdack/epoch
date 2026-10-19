import { treeServerLoad } from '#lib/server/http/page-load.js';
import { ListService } from '#lib/server/services/list-service.js';
import { INDIVIDUAL_SORTS, parseListParams } from '#lib/shared/lists.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to list people', allowPublicVisitor: true },
	async ({ db, ctx, treeId, subtree }, { url }) => {
		const sort =
			url.searchParams.get('sort') === INDIVIDUAL_SORTS.GIVEN
				? INDIVIDUAL_SORTS.GIVEN
				: INDIVIDUAL_SORTS.SURNAME;
		const surname = url.searchParams.get('surname')?.trim() ?? '';
		return {
			sort,
			surname,
			page: await new ListService(db).individuals(
				treeId,
				{ ...parseListParams(url.searchParams), sort, surname },
				ctx,
				subtree?.rootPersonId ?? null
			)
		};
	}
);
