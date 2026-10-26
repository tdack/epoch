import type { GeoCandidate, GeoSearchResponse } from '#lib/shared/geo.js';
import { call, json, path } from './client.js';
import { findPlaceApi } from './lists.js';

/** Places OpenStreetMap offers for `text`. Empty when geocoding is off or the text may not be sent. */
export async function searchGeoApi(
	treeId: string,
	text: string,
	signal?: AbortSignal
): Promise<GeoCandidate[]> {
	const data = await call<GeoSearchResponse>(
		path`/api/trees/${treeId}/geo/search` + `?q=${encodeURIComponent(text)}`,
		{ method: 'GET', signal },
		'Failed to search OpenStreetMap'
	);
	return data.results;
}

const OSM_TYPE_NAMES = { N: 'node', W: 'way', R: 'relation' } as const;

/**
 * Give the place named `text` the chosen candidate's location, unless it has one already. Two
 * requests, so it is a second undo entry after the fact's own. Never throws: the fact is saved, and
 * a contributor (who may not set locations) or a failed lookup just leaves the place unlocated.
 */
export async function attachCandidateLocationApi(
	treeId: string,
	text: string,
	candidate: GeoCandidate
): Promise<void> {
	try {
		const place = await findPlaceApi(treeId, text);
		if (!place || place.location) return;
		const hasOsmRef = candidate.osmType !== null && candidate.osmId !== null;
		await call(
			path`/api/trees/${treeId}/places/${place.id}/location`,
			json('PUT', {
				status: 'confirmed',
				latitude: candidate.latitude,
				longitude: candidate.longitude,
				source: 'photon',
				osmType: hasOsmRef ? OSM_TYPE_NAMES[candidate.osmType!] : null,
				osmId: hasOsmRef ? candidate.osmId : null,
				displayName: candidate.displayName,
				// The place may have been located since the list above was read; the server then does nothing.
				ifUnset: true
			}),
			'Failed to save the location'
		);
	} catch {
		// See above: a convenience, never a reason to fail the save.
	}
}
