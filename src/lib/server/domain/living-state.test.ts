import { describe, expect, it } from 'vitest';
import {
	EVERYONE_SHOWN_CUTOFF,
	PERSON_PRIVACY,
	cutoffParts,
	isLikelyLiving,
	isPersonPrivate,
	isRecentlyDead,
	livingCutoff,
	oldFactsBefore
} from './living-state';

const NOW = new Date('2026-10-01T12:00:00Z');
const cutoff = livingCutoff(NOW);
/** A fact whose lower bound is its upper one, or unknown when the end is. */
const fact = (type: string, end: string | null, start: string | null = end) => ({
	type,
	dateSort: start,
	dateSortEnd: end
});
const birth = (end: string | null, type = 'BIRT') => fact(type, end);

describe('livingCutoff', () => {
	it('is the injected day, 120 years back by default and configurable', () => {
		expect(cutoff).toBe('1906-10-01');
		expect(livingCutoff(NOW, 100)).toBe('1926-10-01');
	});

	it('carries the recent-death day only when the window is on', () => {
		expect(livingCutoff(NOW, 120, 0)).toBe('1906-10-01');
		expect(livingCutoff(NOW, 120, 20)).toBe('1906-10-01/2006-10-01');
		expect(cutoffParts('1906-10-01/2006-10-01')).toEqual({
			livedBefore: '1906-10-01',
			diedBefore: '2006-10-01'
		});
		expect(cutoffParts('1906-10-01')).toEqual({ livedBefore: '1906-10-01', diedBefore: null });
	});

	it('names the day old facts are loaded from, and none on the public tree', () => {
		expect(oldFactsBefore('1906-10-01/2006-10-01')).toBe('1906-10-01');
		expect(oldFactsBefore(EVERYONE_SHOWN_CUTOFF)).toBeUndefined();
	});
});

describe('isLikelyLiving', () => {
	it.each([
		['no facts at all', [], true],
		['an undated death', [fact('DEAT', null)], false],
		['a burial alone', [fact('BURI', null)], false],
		['a cremation alone', [fact('CREM', null)], false],
		['a death beside a recent birth', [birth('2001-05-05'), fact('DEAT', null)], false],
		['a birth long ago', [birth('1850-12-31')], false],
		['a birth the day before the cutoff', [birth('1906-09-30')], false],
		['a birth on the cutoff day', [birth('1906-10-01')], true],
		['a recent birth', [birth('1980-01-01')], true],
		['AFT 1900 (no upper bound)', [fact('BIRT', null, '1900-01-01')], true],
		['BEF 1900 (bounded above)', [birth('1900-12-31')], false],
		['a baptism only, long ago', [birth('1840-06-06', 'BAPM')], false],
		['a christening only, recent', [birth('2000-01-01', 'CHR')], true],
		['an old birth and an undated birth', [birth('1850-01-01'), birth(null)], false],
		// Amended 2026-10-26: one old birth is enough, even beside a conflicting recent one.
		['an old birth and a recent birth', [birth('1850-01-01'), birth('1990-01-01', 'CHR')], false],
		['two old births', [birth('1850-01-01'), birth('1851-01-01', 'CHR')], false],
		// ADR-015, amended 2026-10-26: any own fact that ended before the cutoff, as webtrees reads it.
		['an old census and nothing else', [fact('CENS', '1881-04-03')], false],
		['an old occupation and nothing else', [fact('OCCU', '1700-01-01')], false],
		['an old residence beside an undated birth', [birth(null), fact('RESI', '1890-12-31')], false],
		['a census on the cutoff day', [fact('CENS', '1906-10-01')], true],
		['a recent census', [fact('CENS', '2021-08-10')], true],
		['an undated occupation', [fact('OCCU', null)], true],
		['an open-ended residence (FROM 1850)', [fact('RESI', null, '1850-01-01')], true]
	] as const)('%s', (_name, facts, isExpected) => {
		expect(isLikelyLiving(facts, cutoff)).toBe(isExpected);
	});

	it('finds nobody living on the public tree', () => {
		expect(isLikelyLiving([birth('2000-01-01')], EVERYONE_SHOWN_CUTOFF)).toBe(false);
	});
});

describe('isRecentlyDead', () => {
	const window20 = livingCutoff(NOW, 120, 20);
	it.each([
		['a death inside the window', [fact('DEAT', '2015-03-01')], true],
		['a death on the window day', [fact('DEAT', '2006-10-01')], true],
		['a death the day before the window', [fact('DEAT', '2006-09-30')], false],
		['an undated death', [fact('DEAT', null)], false],
		['a death AFT 2000, which may be recent', [fact('DEAT', null, '2000-01-01')], true],
		['a death BEF 1990', [fact('DEAT', '1989-12-31', null)], false],
		[
			'an undated death and a recent burial',
			[fact('DEAT', null), fact('BURI', '2020-01-10')],
			true
		],
		['a recent occupation, no death', [fact('OCCU', '2020-01-01')], false]
	] as const)('%s', (_name, facts, isExpected) => {
		expect(isRecentlyDead(facts, window20)).toBe(isExpected);
	});

	it('is off without a window, and on the public tree', () => {
		expect(isRecentlyDead([fact('DEAT', '2025-01-01')], cutoff)).toBe(false);
		expect(isRecentlyDead([fact('DEAT', '2025-01-01')], EVERYONE_SHOWN_CUTOFF)).toBe(false);
	});
});

describe('isPersonPrivate', () => {
	const dead = [fact('DEAT', null)];
	const living = [birth('1990-01-01')];
	it('follows the derivation on auto', () => {
		expect(isPersonPrivate(PERSON_PRIVACY.AUTO, living, cutoff)).toBe(true);
		expect(isPersonPrivate(PERSON_PRIVACY.AUTO, dead, cutoff)).toBe(false);
	});
	it('lets an override win either way', () => {
		expect(isPersonPrivate(PERSON_PRIVACY.PRIVATE, dead, cutoff)).toBe(true);
		expect(isPersonPrivate(PERSON_PRIVACY.PUBLIC, living, cutoff)).toBe(false);
	});
	it('hides the recently dead on auto, but not from the contributor who added them', () => {
		const recent = [birth('1950-01-01'), fact('DEAT', '2020-01-01')];
		const window20 = livingCutoff(NOW, 120, 20);
		expect(isPersonPrivate(PERSON_PRIVACY.AUTO, recent, window20)).toBe(true);
		expect(isPersonPrivate(PERSON_PRIVACY.AUTO, recent, cutoff)).toBe(false);
		expect(isPersonPrivate(PERSON_PRIVACY.AUTO, recent, window20, true)).toBe(false);
		expect(isPersonPrivate(PERSON_PRIVACY.PUBLIC, recent, window20)).toBe(false);
	});
});
