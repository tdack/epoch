import { treeServerLoad } from '#lib/server/http/page-load.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the reports', allowPublicVisitor: true },
	async ({ db, ctx, treeId }) => ({ me: await new TreeService(db).selfPerson(treeId, ctx) })
);
