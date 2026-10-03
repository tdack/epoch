import { hasMinimumRole, isManagerOrAbove, type TreeRole } from '#lib/shared/roles.js';
import type { PersonPageDto } from '#lib/shared/person-page.js';

/** Managers and owners set privacy, and only where the DTO carries the setting. */
export const canSetPrivacy = (role: TreeRole | undefined, dto: PersonPageDto): boolean =>
	isManagerOrAbove(role) && dto.privacy !== null;

/** Merging deletes a record, so it needs an editor. */
export const canMergePerson = (role: TreeRole | undefined): boolean =>
	role !== undefined && hasMinimumRole(role, 'editor');
