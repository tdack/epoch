import { describe, expect, it } from 'vitest';
import { canManageMemberOf, describeRole, grantableRoles } from './membership-policy';
import { TREE_ROLES } from './roles';

describe('the roles a person may give', () => {
	it('lets an owner give any role, strongest first', () => {
		expect(grantableRoles('owner')).toEqual([
			'owner',
			'manager',
			'editor',
			'contributor',
			'viewer'
		]);
	});
	it('lets a manager give only roles below manager', () => {
		expect(grantableRoles('manager')).toEqual(['editor', 'contributor', 'viewer']);
	});
	it.each(['editor', 'contributor', 'viewer'] as const)('lets a %s give none', (role) => {
		expect(grantableRoles(role)).toEqual([]);
	});
});

describe('whose membership a person may change or remove', () => {
	it.each(TREE_ROLES)('lets an owner act on a %s', (target) => {
		expect(canManageMemberOf('owner', target)).toBe(true);
	});
	it('lets a manager act on editors, contributors and viewers only', () => {
		expect(TREE_ROLES.filter((target) => canManageMemberOf('manager', target))).toEqual([
			'viewer',
			'contributor',
			'editor'
		]);
	});
	it.each(['editor', 'contributor', 'viewer'] as const)('lets a %s act on nobody', (actor) => {
		for (const target of TREE_ROLES) expect(canManageMemberOf(actor, target)).toBe(false);
	});
});

describe('what a role is described as allowing', () => {
	it('names the tree for every role', () => {
		for (const role of TREE_ROLES) expect(describeRole(role, 'Simpson')).toContain('the Simpson tree');
	});

	it('tells a viewer they may only look', () => {
		expect(describeRole('viewer', 'Simpson')).toBe('View the Simpson tree and its media.');
	});
});
