import { treeHandler } from '#lib/server/http/handler.js';
import { PlaceMatchService } from '#lib/server/services/place-match-service.js';
import { placeMatchAcceptSchema } from '#lib/server/validation/schemas.js';

/**
 * Accept the best candidate of every place still unlocated that scores at least `minScore`, a
 * batch at a time. One change and one undo per call; `remaining` above zero means call again.
 */
export const POST = treeHandler(
	{ failure: 'Failed to accept the matches', body: placeMatchAcceptSchema },
	({ db, ctx, treeId, body: { minScore } }) =>
		new PlaceMatchService(db).acceptMatches(treeId, minScore, ctx)
);
