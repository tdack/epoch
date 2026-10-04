import { hasMinimumRole, type TreeRole } from '#lib/shared/roles.js';

/** Writing a note is creating, which a contributor may do (the same right that adds a fact or a citation). */
export const canAddNote = (role: TreeRole | undefined): boolean =>
	role !== undefined && hasMinimumRole(role, 'contributor');

/** Editing, sharing, reordering or removing a note is an edit, which needs an editor (ADR-029). */
export const canChangeNote = (role: TreeRole | undefined): boolean =>
	role !== undefined && hasMinimumRole(role, 'editor');
