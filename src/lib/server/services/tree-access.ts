import { isActionAllowed, type TreeAction } from '../auth/authorization';
import { UnauthorizedError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import type { UserRepository } from '../repositories/user-repository';

/** Throws unless the caller's role in this tree allows the action; the one check every read service starts with. */
export async function requireTreeAction(
	users: UserRepository,
	treeId: string,
	context: AuthenticatedContext,
	action: TreeAction
): Promise<void> {
	const membership = await users.getMembership(treeId, context.user.id);
	if (!membership || !isActionAllowed(membership.role, action)) {
		throw new UnauthorizedError(`Forbidden: insufficient privileges for action '${action}'`);
	}
}
