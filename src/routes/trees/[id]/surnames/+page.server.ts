import { treeServerLoad } from '#lib/server/http/page-load.js';
import { ListService } from '#lib/server/services/list-service.js';
import { parseListParams } from '#lib/shared/lists.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to list surnames', allowPublicVisitor: true },
	async ({ db, ctx, treeId, subtree }, { url }) => ({
		page: await new ListService(db).surnames(
			treeId,
			parseListParams(url.searchParams),
			ctx,
			subtree?.rootPersonId ?? null
		)
	})
);
