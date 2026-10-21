/**
 * Tree roles and their order, shared so the screens can hide what a role cannot do. The server
 * decides (`auth/authorization.ts` imports this); the screens only avoid offering a button that
 * would answer 403.
 */

export const TREE_ROLES = ['viewer', 'contributor', 'editor', 'manager', 'owner'] as const;
export type TreeRole = (typeof TREE_ROLES)[number];

export function hasMinimumRole(actual: TreeRole, required: TreeRole): boolean {
	return TREE_ROLES.indexOf(actual) >= TREE_ROLES.indexOf(required);
}

/** Managers and owners set privacy, change settings and export. */
export function isManagerOrAbove(role: TreeRole | undefined): boolean {
	return role !== undefined && hasMinimumRole(role, 'manager');
}

/**
 * Contributors and up add people and relationships (`record:create`). Mirrors the server's action
 * table so a screen does not offer what would answer 403; the server still decides.
 */
export function canCreateRecords(role: TreeRole | undefined): boolean {
	return role !== undefined && hasMinimumRole(role, 'contributor');
}

/** Editors and up change and delete records (`record:edit`, `record:delete`). */
export function canChangeRecords(role: TreeRole | undefined): boolean {
	return role !== undefined && hasMinimumRole(role, 'editor');
}

/** Editors and up import a GEDCOM file into the tree (`tree:import`). */
export function canImportGedcom(role: TreeRole | undefined): boolean {
	return role !== undefined && hasMinimumRole(role, 'editor');
}

/**
 * Which of a tree's administration pages the gear in the tree switcher opens (ADR-075): settings for
 * a manager, the audit log for an editor, who reads it and administers nothing else, none below.
 */
export function treeAdminPage(role: TreeRole | undefined): 'settings' | 'audit' | null {
	return isManagerOrAbove(role) ? 'settings' : canChangeRecords(role) ? 'audit' : null;
}
