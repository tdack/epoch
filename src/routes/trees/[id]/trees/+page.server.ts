import { error } from '@sveltejs/kit';
import { treeServerLoad } from '#lib/server/http/page-load.js';
import { PersonPageService } from '#lib/server/services/person-page-service.js';
import { PublicTreeService } from '#lib/server/services/public-tree-service.js';
import { SubtreeService } from '#lib/server/services/subtree-service.js';
import type { PageServerLoad } from './$types';

/**
 * The install owner sees every tree in the install, from a read that refuses anyone else; a
 * member sees their own, which the layout has already loaded. The public visitor has one tree and
 * nothing to choose, so the page is not theirs.
 */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load trees', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { parent }) => {
		const { summary } = await parent();
		if (summary.viewer.isPublicVisitor) error(404, 'Not found');
		const [installTrees, subtrees] = await Promise.all([
			summary.viewer.isInstallOwner ? new PublicTreeService(db).listAll(ctx) : null,
			new SubtreeService(db).list(treeId, ctx)
		]);
		// The list carries ids only; a root the viewer cannot open (deleted, or hidden by privacy) has no
		// name to show, and the row says so rather than failing the page.
		const rootNames: Record<string, string> = {};
		const people = new PersonPageService(db);
		await Promise.all(
			subtrees
				.filter((s) => !s.isRootMissing)
				.map(async (s) => {
					try {
						rootNames[s.rootPersonId] = (
							await people.getPerson(treeId, s.rootPersonId, ctx, null)
						).person.displayName;
					} catch {
						// Left out on purpose.
					}
				})
		);
		return { installTrees, subtrees, rootNames };
	}
);
