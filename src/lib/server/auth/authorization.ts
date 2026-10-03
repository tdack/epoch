import type { TreeRole } from '../../shared/roles';

/**
 * Role hierarchy levels for permission comparisons:
 * viewer (1) < contributor (2) < editor (3) < manager (4) < owner (5)
 */
export const ROLE_HIERARCHY: Record<TreeRole, number> = {
	viewer: 1,
	contributor: 2,
	editor: 3,
	manager: 4,
	owner: 5
};
// The order lives in `shared/roles.ts` too, for the screens; a test holds the two the same.

export type TreeAction =
	| 'tree:view'
	| 'tree:export'
	| 'tree:import'
	| 'tree:manage_members'
	| 'tree:delete'
	| 'tree:update_settings'
	| 'person:set_privacy'
	| 'media:manage'
	| 'media:view'
	| 'record:create'
	| 'record:edit'
	| 'record:delete';

const ACTION_MIN_ROLES: Record<TreeAction, TreeRole> = {
	'tree:view': 'viewer',
	// A GEDCOM export carries living people, and nothing filters it yet (ADR-015), so only the roles
	// that see every person may take one.
	'tree:export': 'manager',
	'record:create': 'contributor',
	'record:edit': 'editor',
	'record:delete': 'editor',
	'tree:import': 'editor',
	'tree:update_settings': 'manager',
	'person:set_privacy': 'manager',
	'media:manage': 'editor',
	'media:view': 'viewer',
	'tree:manage_members': 'manager',
	'tree:delete': 'owner'
};

export function hasMinimumRole(actualRole: TreeRole, requiredRole: TreeRole): boolean {
	return ROLE_HIERARCHY[actualRole] >= ROLE_HIERARCHY[requiredRole];
}

export function isActionAllowed(
	actualRole: TreeRole | undefined | null,
	action: TreeAction
): boolean {
	if (!actualRole) return false;
	const minRequired = ACTION_MIN_ROLES[action];
	return hasMinimumRole(actualRole, minRequired);
}

/**
 * Whether a role sees private people at all. The one place this is decided (ADR-015): editors can
 * change any record, so hiding one from them would only hide what they can already alter.
 * Contributors and viewers get the restricted view.
 */
export function canSeePrivatePeople(role: TreeRole): boolean {
	return hasMinimumRole(role, 'editor');
}
