import { hasMinimumRole, type TreeRole } from '#lib/shared/roles.js';

/** Citing is creating, which a contributor may do (the same right that adds a fact). */
export const canCite = (role: TreeRole | undefined): boolean =>
	role !== undefined && hasMinimumRole(role, 'contributor');

/** Changing or removing a citation, or a source, is an edit, which needs an editor. */
export const canChangeEvidence = (role: TreeRole | undefined): boolean =>
	role !== undefined && hasMinimumRole(role, 'editor');
