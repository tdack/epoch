import type { ImpactResponse, PeopleSearchResponse } from '#lib/shared/api-contracts.js';
import type { PeopleSearchResult, ChangeSummary, ImpactSummary } from '#lib/types/genealogy.js';
import type { MarksDto } from '#lib/shared/marks.js';
import {
	MAX_PLACE_SUGGESTIONS,
	placeKey,
	placeText,
	type PlaceListItem
} from '#lib/shared/places.js';
import type { Page } from '#lib/shared/lists.js';
import { call, json, path } from './client.js';

export async function searchPeopleApi(
	treeId: string,
	query: string
): Promise<PeopleSearchResult[]> {
	const data = await call<PeopleSearchResponse>(
		path`/api/trees/${treeId}/people-search` + `?q=${encodeURIComponent(query)}`,
		undefined,
		'Failed to search people'
	);
	return data.people || [];
}

/** Record a visit; answers with the user's marks as they now stand. */
export function recordRecentApi(treeId: string, personId: string): Promise<MarksDto> {
	return call(
		path`/api/trees/${treeId}/marks/recents`,
		json('POST', { personId }),
		'Failed to record the visit'
	);
}

export function setFavoriteApi(
	treeId: string,
	personId: string,
	isFavorite: boolean
): Promise<MarksDto> {
	return call(
		path`/api/trees/${treeId}/marks/favorites/${personId}`,
		{ method: isFavorite ? 'PUT' : 'DELETE' },
		'Failed to change the favourite'
	);
}

async function fetchPlaces(
	treeId: string,
	params: URLSearchParams,
	fetcher: typeof fetch = fetch
): Promise<Page<PlaceListItem>> {
	return call(
		path`/api/trees/${treeId}/places` + `?${params}`,
		{ method: 'GET' },
		'Failed to list the places',
		fetcher
	);
}

/** Places whose text contains `text`, for the fact editor's suggestions. */
export async function suggestPlacesApi(treeId: string, text: string): Promise<string[]> {
	const data = await fetchPlaces(
		treeId,
		new URLSearchParams({ q: text, limit: String(MAX_PLACE_SUGGESTIONS) })
	);
	return data.items.map((p) => p.name);
}

/** Rename a place, or merge it into the place that already has `name`; one change, one undo. */
export async function rewritePlaceApi(
	treeId: string,
	placeId: string,
	name: string
): Promise<{ change: ChangeSummary | null; name: string }> {
	return call(
		path`/api/trees/${treeId}/places/${placeId}`,
		json('PUT', { name }),
		'Failed to change the place'
	);
}

/** The dates that would take their standard spelling, before and after. Saves nothing. */
export async function previewStandardiseDatesApi(
	treeId: string
): Promise<import('#lib/shared/date-tidy.js').DateTidyPreview> {
	return call(
		path`/api/trees/${treeId}/dates/standardise`,
		{},
		'Failed to preview standardising the dates'
	);
}

/** Give those dates their standard spelling: one change, one undo. */
export async function standardiseDatesApi(
	treeId: string
): Promise<{ change: ChangeSummary | null; remaining: number }> {
	return call(
		path`/api/trees/${treeId}/dates/standardise`,
		{ method: 'POST' },
		'Failed to standardise the dates'
	);
}

export async function previewPlaceRewriteApi(
	treeId: string,
	placeId: string,
	name: string
): Promise<ImpactSummary> {
	const data = await call<ImpactResponse>(
		path`/api/trees/${treeId}/places/${placeId}/impact`,
		json('POST', { name }),
		'Failed to preview the change'
	);
	return data.impact;
}

/** Dismisses every finding named with the one reason, or none of them. */
export async function dismissFindingsApi(
	treeId: string,
	keys: string[],
	reason: string
): Promise<void> {
	await call(
		path`/api/trees/${treeId}/quality`,
		json('PUT', { keys, reason }),
		keys.length === 1 ? 'Failed to dismiss the finding' : 'Failed to dismiss the findings'
	);
}

export async function restoreFindingApi(treeId: string, key: string): Promise<void> {
	await call(
		path`/api/trees/${treeId}/quality` + `?key=${encodeURIComponent(key)}`,
		{ method: 'DELETE' },
		'Failed to restore the finding'
	);
}

/**
 * The place record whose text is `text` (the key is ASCII-case-insensitive), or null. `q` matches
 * by containment, so a short name may sit past the first page; 100 is the page limit.
 */
export async function findPlaceApi(treeId: string, text: string): Promise<PlaceListItem | null> {
	const wanted = placeKey(placeText(text));
	const data = await fetchPlaces(treeId, new URLSearchParams({ q: wanted, limit: '100' }));
	return data.items.find((p) => placeKey(p.name) === wanted) ?? null;
}
