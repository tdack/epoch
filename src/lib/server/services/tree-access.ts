import { canSeePrivatePeople, isActionAllowed, type TreeAction } from '../auth/authorization';
import { NotFoundError, UnauthorizedError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import type { TreeRole } from '../../shared/roles';
import { EVERYONE_SHOWN_CUTOFF, livingCutoff } from '../domain/living-state';
import type { TreeRepository } from '../repositories/tree-repository';
import type { UserRepository } from '../repositories/user-repository';

/**
 * What the caller may see of the tree's private people (ADR-015), decided once per request and
 * handed to every read. `isRestricted` is the only question a service asks; it never compares roles.
 */
export interface ViewerScope {
	role: TreeRole;
	/** The tree is the install's public one. */
	isPublic: boolean;
	/** True when the caller holds no membership and is reading the public tree (ADR-041). */
	isOutsider: boolean;
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
 * Install-wide actions (listing every tree, publishing one) belong to the install owner alone, so
 * they are not a `TreeAction`: no tree role, owner included, grants them (ADR-034, ADR-041).
 */
export function requireInstallOwner(context: AuthenticatedContext): void {
	if (!context.user.isInstallOwner)
		throw new UnauthorizedError('Forbidden: only the owner of this Epoch can do that');
}

/**
 * Refuses the public visitor before anything that would stamp or store a user id. A viewer's role
 * already stops tree writes, but a user-owned write (marks, view mode, task assignment) needs only
 * `tree:view`, so the role alone would let it through.
 */
export function requireRealUser(context: AuthenticatedContext): void {
	if (context.user.isPublicVisitor) throw new UnauthorizedError('Forbidden: sign in to do that');
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
	return (await resolveTreeAccess(users, treeId, userId, action)).role;
}

/** A role, and whether it comes from the tree being public rather than from a membership. */
interface TreeAccess {
	role: TreeRole;
	isOutsider: boolean;
}

async function resolveTreeAccess(
	users: UserRepository,
	treeId: string,
	userId: string,
	action: TreeAction
): Promise<TreeAccess> {
	const membership = await users.getMembership(treeId, userId);
	// The public tree is read by anyone, so a miss is the one case that asks whether it is public;
	// members never pay for the extra read. It is a viewer's role, never more, whoever is asking.
	const access: TreeAccess | null = membership
		? { role: membership.role, isOutsider: false }
		: (await users.isTreePublic(treeId))
			? { role: 'viewer', isOutsider: true }
			: null;
	if (!access || !isActionAllowed(access.role, action)) {
		throw new UnauthorizedError(`Forbidden: insufficient privileges for action '${action}'`);
	}
	return access;
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
	const { role, isOutsider } = await resolveTreeAccess(users, treeId, context.user.id, action);
	const settings = await trees.privacySettings(treeId);
	if (!settings) throw new NotFoundError('Tree', treeId);
	return {
		role,
		isOutsider,
		isPublic: settings.isPublic,
		userId: context.user.id,
		creatorId: role === 'contributor' ? context.user.id : null,
		isRestricted: !canSeePrivatePeople(role),
		// On the public tree the living rule is switched off for the restricted roles, not the whole
		// filter: a person marked private must stay hidden, and `isRestricted: false` would show them.
		cutoff: settings.isPublic
			? EVERYONE_SHOWN_CUTOFF
			: livingCutoff(now, settings.maxAliveYears, settings.recentDeathYears),
		shouldShowPrivateStructure: settings.shouldShowPrivateStructure
	};
}
