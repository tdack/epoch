import { treeHandler } from '#lib/server/http/handler.js';
import { ListService } from '#lib/server/services/list-service.js';
import { parseListParams, INDIVIDUAL_SORTS } from '#lib/shared/lists.js';

/** One page of people: `?sort=surname|given&surname=&offset=&limit=`. */
export const GET = treeHandler(
	{ allowPublicVisitor: true, failure: 'Failed to list people' },
	({ db, ctx, treeId, url }) =>
		new ListService(db).individuals(
			treeId,
			{
				...parseListParams(url.searchParams),
				sort:
					url.searchParams.get('sort') === INDIVIDUAL_SORTS.GIVEN
						? INDIVIDUAL_SORTS.GIVEN
						: INDIVIDUAL_SORTS.SURNAME,
				surname: url.searchParams.get('surname') ?? ''
			},
			ctx
		)
);
