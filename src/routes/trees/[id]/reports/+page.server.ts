import { treeServerLoad } from '#lib/server/http/page-load.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the reports', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { parent }) => {
		// The self-person read answers null for anyone, so the layout's tree check is this page's gate.
		await parent();
		return { me: await new TreeService(db).selfPerson(treeId, ctx) };
	}
);
