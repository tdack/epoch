import { treeServerLoad } from '#lib/server/http/page-load.js';
import { PersonPageService } from '#lib/server/services/person-page-service.js';
import type { PageServerLoad } from './$types';

/** The person page's own read: a sheet handed to a relative never says more than the page would. */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the interview sheet', allowPublicVisitor: true },
	async ({ db, ctx, treeId, subtree }, { params }) => ({
		person: await new PersonPageService(db).getPerson(
			treeId,
			params.personId,
			ctx,
			subtree?.rootPersonId ?? null
		)
	})
);
