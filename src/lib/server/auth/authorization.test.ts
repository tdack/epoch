import { describe, expect, it } from 'vitest';
import { TREE_ROLES } from '../../shared/roles';
import { canSeePrivatePeople, isActionAllowed } from './authorization';

const ROLES = TREE_ROLES;

describe('who sees private people (ADR-015)', () => {
	it.each(ROLES)('%s', (role) => {
		expect(canSeePrivatePeople(role)).toBe(
			role === 'editor' || role === 'manager' || role === 'owner'
		);
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

describe('deleting media', () => {
	it.each(ROLES)('%s may delete any file only as a manager or owner', (role) => {
		expect(isActionAllowed(role, 'media:delete_any')).toBe(role === 'manager' || role === 'owner');
	});
	it.each(ROLES)('%s may manage media only as an editor or above', (role) => {
		expect(isActionAllowed(role, 'media:manage')).toBe(
			role === 'editor' || role === 'manager' || role === 'owner'
		);
	});
});
