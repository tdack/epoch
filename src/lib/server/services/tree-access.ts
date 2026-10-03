import { canSeePrivatePeople, isActionAllowed, type TreeAction } from '../auth/authorization';
import { NotFoundError, UnauthorizedError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import type { TreeRole } from '../../shared/roles';
import { livingCutoff } from '../domain/living-state';
import type { TreeRepository } from '../repositories/tree-repository';
import type { UserRepository } from '../repositories/user-repository';

/**
 * What the caller may see of the tree's private people (ADR-015), decided once per request and
 * handed to every read. `isRestricted` is the only question a service asks; it never compares roles.
 */
export interface ViewerScope {
	role: TreeRole;
	/** The caller, stamped on the people they create. */
	userId: string;
	/**
	 * Set for a contributor: the people they created stay visible to them while private, so a person
	 * added without a dated fact does not vanish. Null for everyone else (a demoted contributor
	 * included: they are no longer the author of anything they may see).
	 */
	creatorId: string | null;
	/** True for contributors and viewers: private people are absent from what they read. */
	isRestricted: boolean;
	/** A birth that ended before this day makes a person not living; computed from an injected `now`. */
	cutoff: string;
	/** Show a restricted viewer a "Private" placeholder in the graph and on partnerships, or omit them. */
	shouldShowPrivateStructure: boolean;
}

/**
 * Throws unless the caller's role in this tree allows the action, and answers that role. The one
 * membership check: every service and the export workflow come through here, so a refusal reads
 * the same wherever it happens.
 */
export async function requireTreeAction(
	users: UserRepository,
	treeId: string,
	context: AuthenticatedContext,
	action: TreeAction
): Promise<TreeRole> {
	return requireMemberAction(users, treeId, context.user.id, action);
}

/** The same check for a job that knows the requester's id but holds no request context. */
export async function requireMemberAction(
	users: UserRepository,
	treeId: string,
	userId: string,
	action: TreeAction
): Promise<TreeRole> {
	const membership = await users.getMembership(treeId, userId);
	if (!membership || !isActionAllowed(membership.role, action)) {
		throw new UnauthorizedError(`Forbidden: insufficient privileges for action '${action}'`);
	}
	return membership.role;
}

/**
 * The action check plus the viewer's scope. One primary-key read of the tree's settings, so even a
 * role that sees everyone is shown the living state the tree's own threshold gives (a manager's
 * "Private" badge must agree with what a viewer is hidden).
 */
export async function requireTreeScope(
	users: UserRepository,
	trees: TreeRepository,
	treeId: string,
	context: AuthenticatedContext,
	action: TreeAction,
	now: Date = new Date()
): Promise<ViewerScope> {
	const role = await requireTreeAction(users, treeId, context, action);
	const settings = await trees.privacySettings(treeId);
	if (!settings) throw new NotFoundError('Tree', treeId);
	return {
		role,
		userId: context.user.id,
		creatorId: role === 'contributor' ? context.user.id : null,
		isRestricted: !canSeePrivatePeople(role),
		cutoff: livingCutoff(now, settings.maxAliveYears),
		shouldShowPrivateStructure: settings.shouldShowPrivateStructure
	};
}
