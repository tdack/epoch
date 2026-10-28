import { NotFoundError } from '#lib/server/domain/errors.js';
import { treeServerLoad } from '#lib/server/http/page-load.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import { UnionPageService } from '#lib/server/services/union-page-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the reports', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { parent, url }) => {
		// The self-person read answers null for anyone, so the layout's tree check is this page's gate.
		await parent();
		const trees = new TreeService(db);
		const focusId = url.searchParams.get('focus');
		const unionId = url.searchParams.get('union');
		// A stale bookmark or a person since hidden falls back quietly, as the tree's focus does.
		const [focus, union] = await Promise.all([
			focusId ? trees.visiblePerson(treeId, focusId, ctx) : null,
			unionId
				? new UnionPageService(db).getUnion(treeId, unionId, ctx).catch((error: unknown) => {
						if (error instanceof NotFoundError) return null;
						throw error;
					})
				: null
		]);
		return {
			me: await trees.selfPerson(treeId, ctx),
			focus,
			union: union && {
				id: union.union.id,
				partners: union.partners
					.filter((p) => !p.isPrivate)
					.map((p) => ({ id: p.id, name: p.displayName }))
			}
		};
	}
);
