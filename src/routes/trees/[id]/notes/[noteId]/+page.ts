import { listQuery, treeLoad } from '#lib/api/load-helpers.js';
import { fetchNote } from '#lib/api/tree-api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, url, fetch }) => ({
	note: await fetchNote(params.id, params.noteId, listQuery(url), fetch)
}));
