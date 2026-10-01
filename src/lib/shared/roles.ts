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
