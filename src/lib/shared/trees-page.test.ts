import { describe, expect, it } from 'vitest';
import { hasTreesPage } from './trees-page';

describe('hasTreesPage', () => {
	it('is for the install owner, and for a member with a default to choose', () => {
		expect(hasTreesPage(true, 1)).toBe(true);
		expect(hasTreesPage(false, 2)).toBe(true);
		expect(hasTreesPage(false, 1)).toBe(false);
		expect(hasTreesPage(false, 0)).toBe(false);
	});
});
