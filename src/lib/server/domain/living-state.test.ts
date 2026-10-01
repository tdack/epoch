import { describe, expect, it } from 'vitest';
import { PERSON_PRIVACY, isLikelyLiving, isPersonPrivate, livingCutoff } from './living-state';

const NOW = new Date('2026-10-01T12:00:00Z');
const cutoff = livingCutoff(NOW);
const birth = (end: string | null, type = 'BIRT') => ({ type, dateSortEnd: end });

describe('livingCutoff', () => {
	it('is the injected day, 120 years back by default and configurable', () => {
		expect(cutoff).toBe('1906-10-01');
		expect(livingCutoff(NOW, 100)).toBe('1926-10-01');
	});
});

describe('isLikelyLiving', () => {
	it.each([
		['no facts at all', [], true],
		['an undated death', [{ type: 'DEAT', dateSortEnd: null }], false],
		['a burial alone', [{ type: 'BURI', dateSortEnd: null }], false],
		['a cremation alone', [{ type: 'CREM', dateSortEnd: null }], false],
		['a death beside a recent birth', [birth('2001-05-05'), { type: 'DEAT', dateSortEnd: null }], false],
		['a birth long ago', [birth('1850-12-31')], false],
		['a birth the day before the cutoff', [birth('1906-09-30')], false],
		['a birth on the cutoff day', [birth('1906-10-01')], true],
		['a recent birth', [birth('1980-01-01')], true],
		['AFT 1900 (no upper bound)', [birth(null)], true],
		['BEF 1900 (bounded above)', [birth('1900-12-31')], false],
		['a baptism only, long ago', [birth('1840-06-06', 'BAPM')], false],
		['a christening only, recent', [birth('2000-01-01', 'CHR')], true],
		['an old birth and an undated birth', [birth('1850-01-01'), birth(null)], true],
		['two old births', [birth('1850-01-01'), birth('1851-01-01', 'CHR')], false],
		['only facts that are not about birth or death', [{ type: 'OCCU', dateSortEnd: '1700-01-01' }], true]
	] as const)('%s', (_name, facts, expected) => {
		expect(isLikelyLiving(facts, cutoff)).toBe(expected);
	});
});

describe('isPersonPrivate', () => {
	const dead = [{ type: 'DEAT', dateSortEnd: null }];
	const living = [birth('1990-01-01')];
	it('follows the derivation on auto', () => {
		expect(isPersonPrivate(PERSON_PRIVACY.AUTO, living, cutoff)).toBe(true);
		expect(isPersonPrivate(PERSON_PRIVACY.AUTO, dead, cutoff)).toBe(false);
	});
	it('lets an override win either way', () => {
		expect(isPersonPrivate(PERSON_PRIVACY.PRIVATE, dead, cutoff)).toBe(true);
		expect(isPersonPrivate(PERSON_PRIVACY.PUBLIC, living, cutoff)).toBe(false);
	});
});
