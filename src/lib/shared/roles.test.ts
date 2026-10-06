import { describe, expect, it } from 'vitest';
import { isActionAllowed } from '#lib/server/auth/authorization.js';
import { TREE_ROLES, canChangeRecords, canCreateRecords } from './roles';

describe('screen capability helpers', () => {
	it('offer exactly what the server allows, for every role', () => {
		for (const role of TREE_ROLES) {
			expect(canCreateRecords(role)).toBe(isActionAllowed(role, 'record:create'));
			expect(canChangeRecords(role)).toBe(isActionAllowed(role, 'record:edit'));
			expect(canChangeRecords(role)).toBe(isActionAllowed(role, 'record:delete'));
		}
		expect(canCreateRecords(undefined)).toBe(false);
		expect(canChangeRecords(undefined)).toBe(false);
	});
});
