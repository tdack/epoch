import { describe, expect, it } from 'vitest';
import {
	boundsOf,
	unionWarnings,
	UNION_WARNING_CODES as C,
	type UnionWarningInput
} from './union-warnings';

const person = (id: string, birth: string | null = null, death: string | null = null) => ({
	id,
	name: id.toUpperCase(),
	birth: boundsOf(birth),
	death: boundsOf(death)
});
const event = (id: string, type: string, date: string | null, label = type) => ({
	id,
	type,
	label,
	date: boundsOf(date)
});
const input = (over: Partial<UnionWarningInput>): UnionWarningInput => ({
	status: 'active',
	partners: [person('a'), person('b')],
	events: [],
	children: [],
	hasTwin: false,
	...over
});
const codes = (i: UnionWarningInput) => unionWarnings(i).map((w) => w.code);

describe('boundsOf', () => {
	it('reads a year as the whole year and never as a day', () => {
		expect(boundsOf('1900')).toEqual({ earliest: '1900-01-01', latest: '1900-12-31' });
	});
	it('leaves an "after" date open above and gives no bounds to text that is not a date', () => {
		expect(boundsOf('AFT 1900')?.latest).toBeNull();
		expect(boundsOf(null)).toBeNull();
		expect(boundsOf('(sometime)')).toBeNull();
	});
});

describe('unionWarnings', () => {
	it('says nothing about an ordinary partnership', () => {
		expect(codes(input({}))).toEqual([]);
	});

	it('notes a missing or single recorded partner, and a twin', () => {
		expect(codes(input({ partners: [] }))).toEqual([C.NO_PARTNERS]);
		expect(codes(input({ partners: [person('a')] }))).toEqual([C.SINGLE_PARTNER]);
		expect(codes(input({ hasTwin: true }))).toEqual([C.MERGEABLE_TWIN]);
	});

	it('notes a death in an active partnership, but not in one that has ended', () => {
		expect(codes(input({ partners: [person('a'), person('b', '1900', '1950')] }))).toEqual([
			C.PARTNER_DIED
		]);
		expect(
			codes(input({ status: 'divorced', partners: [person('a'), person('b', '1900', '1950')] }))
		).toEqual([]);
	});

	it('warns when an event is certainly before a partner’s birth, and not when it might not be', () => {
		const partners = [person('a', '1901'), person('b')];
		expect(codes(input({ partners, events: [event('m', 'MARR', '1899', 'Marriage')] }))).toEqual([
			C.EVENT_BEFORE_BIRTH
		]);
		expect(codes(input({ partners, events: [event('m', 'MARR', 'ABT 1901')] }))).toEqual([]);
		expect(codes(input({ partners, events: [event('m', 'MARR', 'BEF 1905')] }))).toEqual([]);
	});

	it('warns when a marriage is dated after a partner died, but not a divorce', () => {
		const partners = [person('a', '1880', '1910'), person('b')];
		expect(codes(input({ partners, events: [event('m', 'MARR', '1920')] }))).toEqual([
			C.PARTNER_DIED,
			C.START_AFTER_DEATH
		]);
		expect(codes(input({ partners, events: [event('d', 'DIV', '1920')] }))).toEqual([
			C.PARTNER_DIED
		]);
	});

	it('warns when an end is dated before the start', () => {
		const events = [event('m', 'MARR', '1950', 'Marriage'), event('d', 'DIV', '1940', 'Divorce')];
		const warnings = unionWarnings(input({ events, status: 'divorced' }));
		expect(warnings.map((w) => [w.code, w.message])).toEqual([
			[C.END_BEFORE_START, 'Divorce is dated before Marriage.']
		]);
	});

	it('warns when a child is recorded as born before a parent', () => {
		expect(
			codes(
				input({ partners: [person('a', '1950'), person('b')], children: [person('kid', '1940')] })
			)
		).toEqual([C.CHILD_BEFORE_PARENT]);
		expect(
			codes(
				input({ partners: [person('a', '1950'), person('b')], children: [person('kid', '1950')] })
			)
		).toEqual([]);
	});
});
