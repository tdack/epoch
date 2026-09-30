import { describe, expect, it } from 'vitest';
import { ordinal, partnershipLabels } from './partnership-labels';

const marriage = (dateText: string, dateSort: string) => ({ type: 'MARR', dateText, dateSort });

describe('ordinal', () => {
	it.each([
		[1, '1st'],
		[2, '2nd'],
		[3, '3rd'],
		[4, '4th'],
		[11, '11th'],
		[12, '12th'],
		[13, '13th'],
		[21, '21st'],
		[102, '102nd']
	])('%i is %s', (n, expected) => expect(ordinal(n)).toBe(expected));
});

describe('partnershipLabels', () => {
	it('labels nothing for a pair with a single partnership', () => {
		expect(partnershipLabels([{ id: 'u1', partnerIds: ['a', 'b'] }]).size).toBe(0);
	});

	it('orders a pair’s partnerships by when they began, with dates', () => {
		const labels = partnershipLabels([
			{ id: 'remarriage', partnerIds: ['b', 'a'], events: [marriage('2001', '2001-01-01'), { type: 'DIV', dateText: '2005', dateSort: '2005-01-01' }] },
			{ id: 'first', partnerIds: ['a', 'b'], events: [marriage('11 Oct 1980', '1980-10-11'), { type: 'DIV', dateText: '1990', dateSort: '1990-01-01' }] }
		]);
		expect(labels.get('first')).toMatchObject({ position: 1, total: 2, title: '1st partnership', full: '1st partnership (m. 11 Oct 1980 – div. 1990)' });
		expect(labels.get('remarriage')).toMatchObject({ position: 2, full: '2nd partnership (m. 2001 – div. 2005)' });
	});

	it('puts undated partnerships after dated ones, in a stable order', () => {
		const unions = [
			{ id: 'z', partnerIds: ['a', 'b'] },
			{ id: 'dated', partnerIds: ['a', 'b'], events: [marriage('1990', '1990-01-01')] },
			{ id: 'y', partnerIds: ['a', 'b'] }
		];
		const positions = (list: typeof unions) => [...partnershipLabels(list)].map(([id, l]) => `${id}:${l.position}`).sort();
		expect(positions(unions)).toEqual(['dated:1', 'y:2', 'z:3']);
		expect(positions([...unions].reverse())).toEqual(['dated:1', 'y:2', 'z:3']);
	});

	it('does not label people with different partner sets, and ignores partnerships with fewer than two partners', () => {
		const labels = partnershipLabels([
			{ id: 'u1', partnerIds: ['a', 'b'] },
			{ id: 'u2', partnerIds: ['a', 'c'] },
			{ id: 'e1', partnerIds: [] },
			{ id: 'e2', partnerIds: [] },
			// Two one-partner records are not known to be the same pair.
			{ id: 's1', partnerIds: ['a'] },
			{ id: 's2', partnerIds: ['a'] }
		]);
		expect(labels.size).toBe(0);
	});
});

describe('undated repeated partnerships', () => {
	it('are numbered in the order they were recorded, whatever their ids sort to', () => {
		const labels = partnershipLabels([
			{ id: 'zzz', partnerIds: ['a', 'b'], createdAt: 1000 },
			{ id: 'aaa', partnerIds: ['a', 'b'], createdAt: 2000 }
		]);
		expect(labels.get('zzz')!.position).toBe(1);
		expect(labels.get('aaa')!.position).toBe(2);
	});

	it('fall back to id when nothing says which came first', () => {
		const labels = partnershipLabels([
			{ id: 'b', partnerIds: ['x', 'y'] },
			{ id: 'a', partnerIds: ['x', 'y'], createdAt: 5 }
		]);
		expect(labels.get('a')!.position).toBe(1);
	});
});

