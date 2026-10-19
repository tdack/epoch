import { treeServerLoad } from '#lib/server/http/page-load.js';
import { MemberService } from '#lib/server/services/member-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to list the members' },
	async ({ db, ctx, treeId }) => ({ members: await new MemberService(db).list(treeId, ctx) })
);
