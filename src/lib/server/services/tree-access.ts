import { canSeePrivatePeople, isActionAllowed, type TreeAction } from '../auth/authorization';
import { NotFoundError, UnauthorizedError } from '../domain/errors';
import type { AuthenticatedContext, TreeRole } from '../domain/identity';
import { DEFAULT_MAX_ALIVE_YEARS, livingCutoff } from '../domain/living-state';
import type { TreeRepository } from '../repositories/tree-repository';
import type { UserRepository } from '../repositories/user-repository';

/**
 * What the caller may see of the tree's private people (ADR-015), decided once per request and
 * handed to every read. `isRestricted` is the only question a service asks; it never compares roles.
 */
export interface ViewerScope {
	role: TreeRole;
	/** True for contributors and viewers: private people are absent from what they read. */
	isRestricted: boolean;
	/** A birth that ended before this day makes a person not living; computed from an injected `now`. */
	cutoff: string;
	/** Show a restricted viewer a "Private" placeholder in the graph and on partnerships, or omit them. */
	shouldShowPrivateStructure: boolean;
}

/** Throws unless the caller's role in this tree allows the action; the one check every read service starts with. */
export async function requireTreeAction(
	users: UserRepository,
	treeId: string,
	context: AuthenticatedContext,
	action: TreeAction
): Promise<void> {
	await membershipRole(users, treeId, context, action);
}

async function membershipRole(users: UserRepository, treeId: string, context: AuthenticatedContext, action: TreeAction): Promise<TreeRole> {
	const membership = await users.getMembership(treeId, context.user.id);
	if (!membership || !isActionAllowed(membership.role, action)) {
		throw new UnauthorizedError(`Forbidden: insufficient privileges for action '${action}'`);
	}
	return membership.role;
}

/**
 * The action check plus the viewer's scope. A role that sees everyone needs no tree read, so the
 * owner's and editor's reads cost what they did before privacy existed.
 */
export async function requireTreeScope(
	users: UserRepository,
	trees: TreeRepository,
	treeId: string,
	context: AuthenticatedContext,
	action: TreeAction,
	now: Date = new Date()
): Promise<ViewerScope> {
	const role = await membershipRole(users, treeId, context, action);
	if (canSeePrivatePeople(role)) {
		return { role, isRestricted: false, cutoff: livingCutoff(now, DEFAULT_MAX_ALIVE_YEARS), shouldShowPrivateStructure: true };
	}
	const settings = await trees.privacySettings(treeId);
	if (!settings) throw new NotFoundError('Tree', treeId);
	return { role, isRestricted: true, cutoff: livingCutoff(now, settings.maxAliveYears), shouldShowPrivateStructure: settings.shouldShowPrivateStructure };
}
