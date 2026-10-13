import { describe, expect, it } from 'vitest';
import { sourceUrl } from './source-url.js';

describe('sourceUrl', () => {
	it('offers the upstream repository when the install names none', () => {
		expect(sourceUrl(undefined)).toBe('https://github.com/tdack/epoch');
		expect(sourceUrl({})).toBe('https://github.com/tdack/epoch');
		expect(sourceUrl({ EPOCH_SOURCE_URL: '  ' })).toBe('https://github.com/tdack/epoch');
	});

	it("offers a fork's own repository when it sets one", () => {
		expect(sourceUrl({ EPOCH_SOURCE_URL: 'https://example.org/family/epoch' })).toBe(
			'https://example.org/family/epoch'
		);
	});
});
