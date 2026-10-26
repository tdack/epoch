import type { MatchCandidateDto } from '#lib/shared/place-match.js';
import { call, json, path, type Changed } from './client.js';

/** Start a run of Match places for the tree. Answers at once; the run goes on in a workflow. */
export async function startPlaceMatchApi(treeId: string): Promise<void> {
	await call(
		path`/api/trees/${treeId}/places/match`,
		{ method: 'POST' },
		'Failed to start the place match'
	);
}

/**
 * Give the place the candidate's location, unless it has one already (someone may have set it
 * since the page loaded). The text on the facts is not touched.
 */
export async function acceptMatchApi(
	treeId: string,
	placeId: string,
	candidate: MatchCandidateDto
): Promise<Changed> {
	return call(
		path`/api/trees/${treeId}/places/${placeId}/location`,
		json('PUT', {
			status: 'confirmed',
			latitude: candidate.latitude,
			longitude: candidate.longitude,
			source: 'photon',
			osmType: candidate.osmType,
			osmId: candidate.osmId,
			displayName: candidate.displayName,
			shouldSkipIfLocated: true
		}),
		'Failed to save the location'
	);
}

/** One more search, for text the reviewer edited; the place's candidates are replaced by what it finds. */
export async function searchPlaceAgainApi(
	treeId: string,
	placeId: string,
	text: string
): Promise<MatchCandidateDto[]> {
	const data = await call<{ candidates: MatchCandidateDto[] }>(
		path`/api/trees/${treeId}/places/${placeId}/match`,
		json('POST', { text }),
		'Failed to search for the place'
	);
	return data.candidates;
}

/** Accepts the best candidate of up to a batch of places scoring at least `minScore`; one change. */
export async function acceptMatchesApi(
	treeId: string,
	minScore: number
): Promise<Changed & { accepted: number; remaining: number }> {
	return call(
		path`/api/trees/${treeId}/places/match/accept`,
		json('POST', { minScore }),
		'Failed to accept the matches'
	);
}
