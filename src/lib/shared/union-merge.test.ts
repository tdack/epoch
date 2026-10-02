import { describe, expect, it } from 'vitest';
import {
	findMergeConflicts,
	partnerSetKey,
	unresolvedConflicts,
	type MergeFact
} from './union-merge';

const fact = (type: string, dateText: string | null, place: string | null = null): MergeFact => ({
	type,
	dateText,
	place,
	description: null
});
const union = (id: string, facts: MergeFact[] = [], status = 'active') => ({ id, status, facts });

describe('findMergeConflicts', () => {
	it('finds nothing when the unions carry no facts, or identical ones', () => {
		expect(findMergeConflicts([union('a'), union('b')])).toEqual([]);
		expect(
			findMergeConflicts([
				union('a', [fact('MARR', '1975', 'Perth')]),
				union('b', [fact('MARR', ' 1975 ', 'perth')])
			])
		).toEqual([]);
	});

	it('does not call a fact on one side only a conflict', () => {
		expect(findMergeConflicts([union('a', [fact('MARR', '1975')]), union('b')])).toEqual([]);
	});

	it('reports two different marriage dates, and a same date in a different place', () => {
		expect(
			findMergeConflicts([union('a', [fact('MARR', '1975')]), union('b', [fact('MARR', '1980')])])
		).toMatchObject([
			{ kind: 'event', eventType: 'MARR', options: [{ unionId: 'a' }, { unionId: 'b' }] }
		]);
		expect(
			findMergeConflicts([
				union('a', [fact('MARR', '1975', 'Perth')]),
				union('b', [fact('MARR', '1975', 'Sydney')])
			])
		).toHaveLength(1);
	});

	it('reports differing statuses, and each event type separately', () => {
		const conflicts = findMergeConflicts([
			union('a', [fact('MARR', '1975'), fact('DIV', '1990')], 'divorced'),
			union('b', [fact('MARR', '1976'), fact('DIV', '1991')], 'active')
		]);
		expect(conflicts.map((c) => (c.kind === 'status' ? 'status' : c.eventType))).toEqual([
			'status',
			'DIV',
			'MARR'
		]);
	});
});

describe('unresolvedConflicts', () => {
	const conflicts = findMergeConflicts([
		union('a', [fact('MARR', '1975')], 'divorced'),
		union('b', [fact('MARR', '1980')])
	]);

	it('leaves every conflict open without a choice', () => {
		expect(unresolvedConflicts(conflicts, undefined)).toHaveLength(2);
	});

	it('closes a conflict only when the choice names a union that stated a value', () => {
		expect(unresolvedConflicts(conflicts, { status: 'a', events: { MARR: 'b' } })).toEqual([]);
		expect(unresolvedConflicts(conflicts, { status: 'zzz', events: { MARR: 'b' } })).toHaveLength(
			1
		);
	});
});

describe('partnerSetKey', () => {
	it('is the same for the same people in either order', () => {
		expect(partnerSetKey(['b', 'a'])).toBe(partnerSetKey(['a', 'b']));
		expect(partnerSetKey(['a'])).not.toBe(partnerSetKey(['a', 'b']));
	});
});
