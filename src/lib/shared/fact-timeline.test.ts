import { describe, expect, it } from 'vitest';
import {
	CONFLICT_KINDS,
	findFactConflicts,
	sortTimeline,
	type TimelineFact
} from './fact-timeline';

const fact = (id: string, type: string, extra: Partial<TimelineFact> = {}): TimelineFact => ({
	id,
	type,
	dateText: null,
	sortStart: null,
	place: null,
	value: null,
	cause: null,
	age: null,
	notes: null,
	sortOrder: 0,
	...extra
});

describe('sortTimeline', () => {
	it('puts dated facts in date order and undated ones after, keeping recorded order among ties', () => {
		const sorted = sortTimeline([
			fact('undated-1', 'OCCU'),
			fact('death', 'DEAT', { sortStart: '1980-01-01' }),
			fact('undated-2', 'RESI'),
			fact('birth', 'BIRT', { sortStart: '1900-03-04' })
		]);
		expect(sorted.map((f) => f.id)).toEqual(['birth', 'death', 'undated-1', 'undated-2']);
	});

	it('lets the manual order break a tie on the same date, and only a tie', () => {
		const sorted = sortTimeline([
			fact('later-date', 'RESI', { sortStart: '1950-01-01', sortOrder: 0 }),
			fact('b', 'OCCU', { sortStart: '1920-01-01', sortOrder: 2 }),
			fact('a', 'RESI', { sortStart: '1920-01-01', sortOrder: 1 })
		]);
		expect(sorted.map((f) => f.id)).toEqual(['a', 'b', 'later-date']);
	});

	it('does not change the input', () => {
		const input = [fact('x', 'BIRT', { sortStart: '1900-01-01' }), fact('y', 'BIRT')];
		sortTimeline(input);
		expect(input.map((f) => f.id)).toEqual(['x', 'y']);
	});
});

describe('findFactConflicts', () => {
	it('flags two births with different details as a conflicting pair', () => {
		const flags = findFactConflicts([
			fact('b1', 'BIRT', { dateText: '4 MAR 1900', place: 'Leeds' }),
			fact('b2', 'BIRT', { dateText: '5 MAR 1900', place: 'Hull' })
		]);
		expect(flags.get('b1')).toEqual({ kind: CONFLICT_KINDS.CONFLICT, otherIds: ['b2'] });
		expect(flags.get('b2')).toEqual({ kind: CONFLICT_KINDS.CONFLICT, otherIds: ['b1'] });
	});

	it('does not call two residences or occupations a conflict, which a person often has', () => {
		expect(
			findFactConflicts([
				fact('r1', 'RESI', { place: 'Leeds' }),
				fact('r2', 'RESI', { place: 'Hull' })
			]).size
		).toBe(0);
		expect(
			findFactConflicts([
				fact('o1', 'OCCU', { value: 'Joiner' }),
				fact('o2', 'OCCU', { value: 'Teacher' })
			]).size
		).toBe(0);
	});

	it('flags identical facts as repeats, whatever the type, ignoring case and spacing', () => {
		const flags = findFactConflicts([
			fact('r1', 'RESI', { place: 'Leeds' }),
			fact('r2', 'RESI', { place: ' leeds ' })
		]);
		expect(flags.get('r1')?.kind).toBe(CONFLICT_KINDS.REPEAT);
		expect(flags.get('r2')?.otherIds).toEqual(['r1']);
	});

	it('flags only the ones that differ when a third fact repeats the first', () => {
		const flags = findFactConflicts([
			fact('b1', 'BIRT', { dateText: '1900' }),
			fact('b2', 'BIRT', { dateText: '1900' }),
			fact('b3', 'BIRT', { dateText: '1901' })
		]);
		expect(flags.get('b1')?.kind).toBe(CONFLICT_KINDS.REPEAT);
		expect(flags.get('b3')).toEqual({ kind: CONFLICT_KINDS.CONFLICT, otherIds: ['b1', 'b2'] });
	});

	it('says nothing about a single fact of a type', () => {
		expect(findFactConflicts([fact('b1', 'BIRT')]).size).toBe(0);
	});
});
