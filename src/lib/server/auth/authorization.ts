import { hasMinimumRole, type TreeRole } from '../../shared/roles';

export type TreeAction =
	| 'tree:view'
	| 'tree:export'
	| 'tree:import'
	| 'tree:manage_members'
	| 'tree:delete'
	| 'tree:update_settings'
	| 'tree:set_default_view'
	| 'person:set_privacy'
	| 'media:manage'
	| 'media:delete_any'
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
	// Decides how everyone's link without a `mode` opens, so it is the owner's alone (S16 stage 8).
	'tree:set_default_view': 'owner',
	'person:set_privacy': 'manager',
	'media:manage': 'editor',
	// Deleting a file someone else uploaded is a manager's call; an editor may delete their own.
	'media:delete_any': 'manager',
	'media:view': 'viewer',
	'tree:manage_members': 'manager',
	'tree:delete': 'owner'
};

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
