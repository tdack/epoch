import { error } from '@sveltejs/kit';
import { treeLoad } from '#lib/services/load-helpers.js';
import { fetchFileUsage, fetchFiles } from '#lib/services/tree-api.js';
import type { PageLoad } from './$types';

/**
 * The files of the tree, to start with, and the storage the caller may see. The public visitor and
 * a reader with no membership of the tree are not offered the manager at all; the server would
 * refuse their list anyway, so the page is a 404 for them rather than an empty table.
 */
export const load: PageLoad = treeLoad(async ({ params, fetch, parent }) => {
	const { summary } = await parent();
	if (summary.viewer.isPublicVisitor || summary.viewer.isOutsider) error(404, 'Not found');
	const [files, usage] = await Promise.all([
		fetchFiles({ treeId: params.id }, fetch),
		fetchFileUsage(null, fetch)
	]);
	return { files, usage };
});
