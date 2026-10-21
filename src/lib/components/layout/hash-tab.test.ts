import { describe, expect, it } from 'vitest';
import { hashTab } from './hash-tab';

describe('hashTab', () => {
	const ids = ['profile', 'trees'] as const;

	it('picks the tab the fragment names', () => {
		expect(hashTab('#trees', ids)).toBe('trees');
	});

	it('opens the tab that holds a section an old link names', () => {
		expect(
			hashTab('#visibility', ['settings', 'export'] as const, { visibility: 'settings' })
		).toBe('settings');
	});

	it('falls back to the first tab for no fragment or an unknown one', () => {
		expect(hashTab('', ids)).toBe('profile');
		expect(hashTab('#nope', ids)).toBe('profile');
	});
});
