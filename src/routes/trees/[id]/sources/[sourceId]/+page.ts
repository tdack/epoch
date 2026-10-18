import { listQuery, treeLoad } from '#lib/api/load-helpers.js';
import { fetchSource } from '#lib/api/evidence.js';
import { fetchFiles } from '#lib/api/files.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, url, fetch, parent }) => {
	const { summary } = await parent();
	// The public visitor and a reader outside the tree get no Files list (the server refuses it), so
	// the page leaves the section out for them rather than showing an empty one.
	const hasFiles = !summary.viewer.isPublicVisitor && !summary.viewer.isOutsider;
	const [source, files] = await Promise.all([
		fetchSource(params.id, params.sourceId, listQuery(url), fetch),
		// A listing, not part of the source: the same visibility rule decides each file (ADR-061).
		// The address may carry the tree's slug, which the list does not recognise: the layout has the id.
		hasFiles
			? fetchFiles({ treeId: summary.tree.id, entityId: params.sourceId, limit: 100 }, fetch)
			: null
	]);
	return { source, files: files?.files ?? null };
});
