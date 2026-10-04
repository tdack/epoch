import { listQuery, treeLoad } from '#lib/services/load-helpers.js';
import { fetchNote } from '#lib/services/tree-api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, url, fetch }) => ({
	note: await fetchNote(params.id, params.noteId, listQuery(url), fetch)
}));
