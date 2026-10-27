import { treeServerLoad } from '#lib/server/http/page-load.js';
import { PersonPageService } from '#lib/server/services/person-page-service.js';
import type { PageServerLoad } from './$types';

/** The person page's own read, so the summary can never show more than the page does. */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the evidence summary', allowPublicVisitor: true },
	async ({ db, ctx, treeId, subtree }, { params }) => ({
		person: await new PersonPageService(db).getPerson(
			treeId,
			params.personId,
			ctx,
			subtree?.rootPersonId ?? null
		)
	})
);
