import { describe, expect, it } from 'vitest';
import type { TreeRole } from '../domain/identity';
import { TREE_ROLES, hasMinimumRole as hasMinimumRoleShared } from '../../shared/roles';
import { ROLE_HIERARCHY, canSeePrivatePeople, hasMinimumRole, isActionAllowed } from './authorization';

const ROLES: TreeRole[] = ['viewer', 'contributor', 'editor', 'manager', 'owner'];

describe('who sees private people (ADR-015)', () => {
	it.each(ROLES)('%s', (role) => {
		expect(canSeePrivatePeople(role)).toBe(role === 'editor' || role === 'manager' || role === 'owner');
	});
});

describe('actions that expose or change privacy', () => {
	it.each(ROLES)('%s may export and set privacy only as a manager or owner', (role) => {
		const isManagerUp = role === 'manager' || role === 'owner';
		expect(isActionAllowed(role, 'tree:export')).toBe(isManagerUp);
		expect(isActionAllowed(role, 'person:set_privacy')).toBe(isManagerUp);
	});
	it('denies a caller with no role', () => {
		expect(isActionAllowed(null, 'tree:view')).toBe(false);
	});
});

describe('the roles the screens use', () => {
	it('are ranked the same way as the server ranks them', () => {
		const ranked = [...TREE_ROLES].sort((a, b) => ROLE_HIERARCHY[a] - ROLE_HIERARCHY[b]);
		expect(ranked).toEqual([...TREE_ROLES]);
		for (const a of ROLES) for (const b of ROLES) expect(hasMinimumRoleShared(a, b)).toBe(hasMinimumRole(a, b));
	});
});
