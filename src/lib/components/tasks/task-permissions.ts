import { hasMinimumRole, type TreeRole } from '#lib/shared/roles.js';

/** Making a task is creating, which a contributor may do (the same right that adds a fact or a note). */
export const canAddTask = (role: TreeRole | undefined): boolean =>
	role !== undefined && hasMinimumRole(role, 'contributor');

/** Deleting a task needs an editor; a task nobody needs is better dropped, which keeps the record of it. */
export const canDeleteTask = (role: TreeRole | undefined): boolean =>
	role !== undefined && hasMinimumRole(role, 'editor');
