/**
 * Who may give a role to whom (ADR-016). Pure and shared: the server decides with it, and the
 * members screen offers only the roles it would not refuse. The last-owner rule needs a count of
 * the tree's owners, so it is enforced where that count is, in the member service.
 */

import { TREE_ROLES, type TreeRole } from './roles';

const rank = (role: TreeRole) => TREE_ROLES.indexOf(role);

/**
 * The roles `actor` may give, by invitation or by changing a member. An owner may give any role,
 * so ownership moves by an owner's own act and by nobody else's. A manager may give only roles
 * below their own, so they can never create a peer or a superior; every other role gives none.
 */
export function grantableRoles(actor: TreeRole): TreeRole[] {
	if (actor === 'owner') return [...TREE_ROLES].reverse();
	if (actor === 'manager') return TREE_ROLES.filter((role) => rank(role) < rank(actor)).reverse();
	return [];
}

/**
 * Whether `actor` may change or remove a member who holds `target`. An owner may act on anyone; a
 * manager only on someone below manager, never on a peer, an owner or themselves.
 */
export function canManageMemberOf(actor: TreeRole, target: TreeRole): boolean {
	if (actor === 'owner') return true;
	if (actor === 'manager') return rank(target) < rank(actor);
	return false;
}
