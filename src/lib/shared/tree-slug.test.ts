import { describe, expect, it } from 'vitest';
import {
	subtreePath,
	canonicalTreeAddress,
	isValidTreeSlug,
	slugifyTreeName,
	splitTreeSegment,
	treePath
} from './tree-slug';

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

describe('canonicalTreeAddress', () => {
	const tree = { id: 'b8ea1a57-5542-437c-99df-00c5d8ee5970', slug: 'the-windsors' };

	it('moves an id address to the slug, keeping the path and the query', () => {
		const url = new URL(`https://epoch.test/trees/${tree.id}/people/p1?focus=x&mode=rings`);
		expect(canonicalTreeAddress(url, tree.id, tree)).toBe(
			'/trees/the-windsors/people/p1?focus=x&mode=rings'
		);
	});

	it('leaves a canonical address alone, and an id address for a tree with no slug', () => {
		expect(
			canonicalTreeAddress(new URL('https://epoch.test/trees/the-windsors'), 'the-windsors', tree)
		).toBeNull();
		expect(
			canonicalTreeAddress(new URL(`https://epoch.test/trees/${tree.id}`), tree.id, {
				id: tree.id,
				slug: null
			})
		).toBeNull();
	});

	it('replaces whatever segment the address used with the canonical one', () => {
		const url = new URL('https://epoch.test/trees/old-name/notes');
		expect(canonicalTreeAddress(url, 'old-name', tree)).toBe('/trees/the-windsors/notes');
	});
});

describe('splitTreeSegment', () => {
	it('separates the sub-tree riding inside the segment', () => {
		expect(splitTreeSegment('dacks~bouvier-line')).toEqual({
			tree: 'dacks',
			subtree: 'bouvier-line'
		});
		expect(splitTreeSegment('dacks')).toEqual({ tree: 'dacks', subtree: null });
		expect(splitTreeSegment('dacks~')).toEqual({ tree: 'dacks', subtree: null });
	});
});

describe('treePath with a sub-tree', () => {
	it('appends the lens, and drops it when null', () => {
		expect(treePath({ id: 'i', slug: 'dacks', subtree: 'x y' })).toBe('/trees/dacks~x%20y');
		expect(treePath({ id: 'i', slug: 'dacks', subtree: null })).toBe('/trees/dacks');
	});

	it('canonicalises both halves and keeps the lens', () => {
		const url = new URL('https://epoch.test/trees/t-id~s-id/people?q=1');
		expect(
			canonicalTreeAddress(url, 't-id~s-id', { id: 't-id', slug: 'dacks', subtree: 'bouvier' })
		).toBe('/trees/dacks~bouvier/people?q=1');
	});
});

describe('subtreePath', () => {
	it('adds the sub-tree to the tree', () => {
		expect(subtreePath({ id: 't1', slug: 'dacks' }, 'bouvier-line')).toBe(
			'/trees/dacks~bouvier-line'
		);
	});

	it('replaces a lens the ref already carries, in its slug or as its subtree', () => {
		expect(subtreePath({ id: 't1', slug: 'dacks~simpson-line' }, 'bouvier-line')).toBe(
			'/trees/dacks~bouvier-line'
		);
		expect(subtreePath({ id: 't1', slug: 'dacks', subtree: 'simpson-line' }, 'bouvier-line')).toBe(
			'/trees/dacks~bouvier-line'
		);
	});

	it('falls back to the id for a tree with no slug', () => {
		expect(subtreePath({ id: 't1' }, 'x')).toBe('/trees/t1~x');
	});
});
