import { listQuery, treeLoad } from '#lib/api/load-helpers.js';
import { fetchPlace } from '#lib/api/lists.js';
import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** The place is in the address as `?name=`, the text of the place as it is written on its facts. */
export const load: PageLoad = treeLoad(async ({ params, url, fetch }) => {
	const name = url.searchParams.get('name');
	if (!name) error(404, 'Place not found');
	return { place: await fetchPlace(params.id, name, listQuery(url), fetch) };
});
