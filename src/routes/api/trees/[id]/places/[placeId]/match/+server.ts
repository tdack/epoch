import { treeHandler } from '#lib/server/http/handler.js';
import { PlaceMatchService } from '#lib/server/services/place-match-service.js';
import type { MatchCandidateDto } from '#lib/shared/place-match.js';
import { placeMatchSearchSchema } from '#lib/server/validation/schemas.js';

/** Search Photon once for edited text and replace this place's candidates with what it finds. */
export const POST = treeHandler(
	{
		failure: 'Failed to search for the place',
		params: ['placeId'],
		body: placeMatchSearchSchema
	},
	async ({
		db,
		ctx,
		treeId,
		params,
		body: { text }
	}): Promise<{ candidates: MatchCandidateDto[] }> => ({
		candidates: await new PlaceMatchService(db).searchAgain(treeId, params.placeId, text, ctx)
	})
);
