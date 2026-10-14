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

/**
 * What `role` may do in the tree called `treeName`, as one sentence for whoever is choosing a role
 * to give. It restates `auth/authorization.ts`'s action table and the privacy rule (ADR-015) in
 * words, so a change to either needs one here too.
 */
export function describeRole(role: TreeRole, treeName: string): string {
	switch (role) {
		case 'viewer':
			return `View the ${treeName} tree and its media.`;
		case 'contributor':
			return `View the ${treeName} tree and add people, relationships, sources, citations and notes. Private living people stay hidden, apart from those they add.`;
		case 'editor':
			return `Add, edit, delete and merge any record in the ${treeName} tree, import GEDCOM and manage media, deleting only the files they uploaded. Private living people are visible.`;
		case 'manager':
			return `Everything an editor can do in the ${treeName} tree, plus delete any media file, export GEDCOM, change settings, set privacy, and invite and manage editors, contributors and viewers.`;
		case 'owner':
			return `Full control of the ${treeName} tree: everything a manager can do, plus manage any member, set the default view and delete the tree.`;
	}
}
