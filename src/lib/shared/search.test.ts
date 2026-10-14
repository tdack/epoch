import { describe, expect, it } from 'vitest';
import { foldQuery } from './search';

describe('foldQuery', () => {
	it('drops diacritics and lower-cases, so the accented and plain spellings are one word', () => {
		expect(foldQuery('Müller')).toBe('muller');
		expect(foldQuery('ZOË')).toBe('zoe');
		expect(foldQuery('Ångström')).toBe('angstrom');
	});

	it('leaves unaccented text as it is, apart from case', () => {
		expect(foldQuery('Smith')).toBe('smith');
		expect(foldQuery("o'brien")).toBe("o'brien");
	});

	it('does not transliterate: "mueller" stays a different word from "müller"', () => {
		expect(foldQuery('mueller')).not.toBe(foldQuery('müller'));
	});

	it('folds a decomposed accent the same as a precomposed one', () => {
		expect(foldQuery('Müller')).toBe(foldQuery('Müller'));
	});
});
