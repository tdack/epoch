import { treeHandler } from '#lib/server/http/handler.js';
import { PlaceMatchService } from '#lib/server/services/place-match-service.js';
import { parseListParams } from '#lib/shared/lists.js';

/**
 * Start a place match: Photon is asked about the places with no location, one run per tree. A
 * manager's; answers 409 while a run is going and 400 when geocoding is switched off.
 */
export const POST = treeHandler(
	{ failure: 'Failed to start the place match', status: 202 },
	({ db, ctx, treeId, event }) =>
		new PlaceMatchService(db).start(treeId, ctx, event.platform?.env?.PLACE_MATCH_WORKFLOW)
);

/** The run's progress and a page of unlocated places with their candidates, best first. */
export const GET = treeHandler(
	{ failure: 'Failed to load the place matches' },
	({ db, ctx, treeId, url }) =>
		new PlaceMatchService(db).review(treeId, parseListParams(url.searchParams), ctx)
);
