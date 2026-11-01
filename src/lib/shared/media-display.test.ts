import { describe, expect, it } from 'vitest';
import { extraFilesLabel, isWebUrl, unresolvedFileLabel } from './media';

describe('isWebUrl', () => {
	it('accepts only http and https addresses', () => {
		expect(isWebUrl('https://example.org/a.jpg?s=1')).toBe(true);
		expect(isWebUrl('http://example.org/a.jpg')).toBe(true);
		for (const text of [
			'file:///C:/a.jpg',
			'javascript:alert(1)',
			'data:text/html,hi',
			'C:\\Photos\\a.jpg',
			'media/a%20b.jpg',
			'a b.jpg',
			'',
			null
		])
			expect(isWebUrl(text)).toBe(false);
	});
});

describe('unresolvedFileLabel', () => {
	it('prefers the title, then the last segment of the path, then a plain name', () => {
		expect(unresolvedFileLabel({ title: ' Wedding ', gedcomPath: 'a/b.jpg' })).toBe('Wedding');
		expect(unresolvedFileLabel({ title: null, gedcomPath: 'C:\\Photos\\ada 1923.jpg' })).toBe(
			'ada 1923.jpg'
		);
		expect(unresolvedFileLabel({ title: null, gedcomPath: 'https://x.org/p/a.jpg?s=1#top' })).toBe(
			'a.jpg'
		);
		expect(unresolvedFileLabel({ title: '', gedcomPath: 'media/dir/' })).toBe('dir');
		expect(unresolvedFileLabel({ title: null, gedcomPath: null })).toBe('Missing file');
	});
});

describe('extraFilesLabel', () => {
	it('counts the files beyond the first', () => {
		expect(extraFilesLabel(0)).toBe('Details');
		expect(extraFilesLabel(1)).toBe('+1 file');
		expect(extraFilesLabel(3)).toBe('+3 files');
	});
});
