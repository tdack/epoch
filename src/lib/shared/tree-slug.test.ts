import { describe, expect, it } from 'vitest';
import { isValidTreeSlug, slugifyTreeName, treePath } from './tree-slug';

describe('slugifyTreeName', () => {
	it('makes hyphenated lower-case words of a name', () => {
		expect(slugifyTreeName('The Windsors')).toBe('the-windsors');
		expect(slugifyTreeName("  The O'Brien  Family (Cork) ")).toBe('the-o-brien-family-cork');
	});

	it('drops accents, and gives up on a name with nothing Latin in it', () => {
		expect(slugifyTreeName('Ålesund Café')).toBe('alesund-cafe');
		expect(slugifyTreeName('山田家')).toBeNull();
		expect(slugifyTreeName('---')).toBeNull();
	});

	it('caps the length without leaving a trailing hyphen', () => {
		const slug = slugifyTreeName(`${'a'.repeat(59)} b`)!;
		expect(slug).toBe('a'.repeat(59));
	});
});

describe('isValidTreeSlug', () => {
	it('accepts only the shape slugify produces', () => {
		expect(isValidTreeSlug('the-dacks')).toBe(true);
		expect(isValidTreeSlug('dacks-2')).toBe(true);
		for (const bad of ['', 'The-Dacks', 'the--dacks', '-dacks', 'dacks-', 'the dacks', 'a/b'])
			expect(isValidTreeSlug(bad)).toBe(false);
	});

	it('refuses a UUID, which would read as a tree id', () => {
		expect(isValidTreeSlug('b8ea1a57-5542-437c-99df-00c5d8ee5970')).toBe(false);
	});
});

describe('treePath', () => {
	it('prefers the slug and falls back to the id', () => {
		expect(treePath({ id: 'abc', slug: 'the-dacks' })).toBe('/trees/the-dacks');
		expect(treePath({ id: 'abc', slug: null })).toBe('/trees/abc');
	});
});
