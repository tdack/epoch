import { generationsParam } from '#lib/api/load-helpers.js';
import { treeServerLoad } from '#lib/server/http/page-load.js';
import { KinshipService } from '#lib/server/services/kinship-service.js';
import { DEFAULT_KIN_LIST_GENERATIONS, MAX_KIN_LIST_GENERATIONS } from '#lib/shared/kinship.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the relatives', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { params, url }) => ({
		kin: await new KinshipService(db).kinshipList(
			treeId,
			params.personId,
			generationsParam(url, 'generations', {
				fallback: DEFAULT_KIN_LIST_GENERATIONS,
				max: MAX_KIN_LIST_GENERATIONS
			}),
			ctx
		)
	})
);
