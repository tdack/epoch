import { treeHandler } from '#lib/server/http/handler.js';
import { PersonPageService } from '#lib/server/services/person-page-service.js';

/** Everything the person page shows, from bounded reads: see `PersonPageDto`. */
export const GET = treeHandler(
	{ failure: 'Failed to load the person', params: ['personId'] },
	({ db, ctx, treeId, params }) => new PersonPageService(db).getPerson(treeId, params.personId, ctx)
);
