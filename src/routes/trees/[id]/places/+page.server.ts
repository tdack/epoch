import { treeServerLoad } from '#lib/server/http/page-load.js';
import { PlaceService } from '#lib/server/services/place-service.js';
import { parseListParams } from '#lib/shared/lists.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to list places', allowPublicVisitor: true },
	async ({ db, ctx, treeId, subtree }, { url }) => {
		const q = url.searchParams.get('q') ?? '';
		return {
			q,
			page: await new PlaceService(db).list(
				treeId,
				{ q, ...parseListParams(url.searchParams) },
				ctx,
				subtree?.rootPersonId ?? null
			)
		};
	}
);
