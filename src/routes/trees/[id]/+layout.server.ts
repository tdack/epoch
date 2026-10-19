import { redirect } from '@sveltejs/kit';
import { treeServerLoad } from '#lib/server/http/page-load.js';
import { GraphQueryService } from '#lib/server/services/graph-query-service.js';
import { MarkService } from '#lib/server/services/mark-service.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import { canonicalTreeAddress } from '#lib/shared/tree-slug.js';
import type { LayoutServerLoad } from './$types';

/** What every screen under a tree needs: the tree list, this tree's name and counts, and the user's shortcuts. */
export const load: LayoutServerLoad = treeServerLoad(
	{ failure: 'Failed to load the tree', allowPublicVisitor: true },
	async ({ db, ctx, treeId, subtree }, { params, url }) => {
		// Shortcuts are a convenience: a failure to load them must not take the tree page down.
		const marks = new MarkService(db)
			.get(treeId, ctx)
			.catch(() => ({ favorites: [], recents: [] }));
		const [trees, summary] = await Promise.all([
			new TreeService(db).listTrees(ctx),
			new GraphQueryService(db).summary(treeId, ctx, subtree)
		]);
		// An address by id, from an old bookmark or a link that only knew the id, moves to the slug, so
		// the address bar always shows the readable form and one tree has one address (ADR-045).
		// The sub-tree rides in the segment, and canonicalises to its slug like the tree does.
		const lens = summary.subtree ?? null;
		const tree = { ...summary.tree, subtree: lens?.slug ?? null };
		const canonical = canonicalTreeAddress(url, params.id, tree);
		// Not permanent: a browser caches a 308, and the slug can be changed or given up.
		if (canonical) redirect(302, canonical);
		// `tree.subtree` makes every `treePath(data.summary.tree)` link keep the lens; a link that leaves
		// it passes `subtree: null`. Writes use `tree.id` and never see it.
		return { trees, summary: { ...summary, tree }, marks: await marks };
	}
);
