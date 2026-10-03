import { treeHandler } from '#lib/server/http/handler.js';
import { MemberService } from '#lib/server/services/member-service.js';

/** The tree's members and pending invitations, for a manager or owner (ADR-016). */
export const GET = treeHandler({ failure: 'Failed to list the members' }, ({ db, ctx, treeId }) =>
	new MemberService(db).list(treeId, ctx)
);
