import { treeServerLoad } from '#lib/server/http/page-load.js';
import { PersonPageService } from '#lib/server/services/person-page-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the person', allowPublicVisitor: true },
	async ({ db, ctx, treeId, subtree }, { params }) => ({
		person: await new PersonPageService(db).getPerson(
			treeId,
			params.personId,
			ctx,
			subtree?.rootPersonId ?? null
		)
	})
);
