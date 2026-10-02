import { describe, expect, it } from 'vitest';
import { makeLabeler } from './tree-labels';
import { treeRows } from '../testing/rows';

const people = [
	{ id: 'a', givenName: 'Ann' },
	{ id: 'b', givenName: 'Ben' }
];

describe('partnership labels in previews', () => {
	it('tells repeated partnerships between two people apart by chronology, with dates', () => {
		const rows = treeRows({
			people,
			unions: [
				{ id: 'late', partners: ['a', 'b'], marriage: '2001' },
				{ id: 'early', partners: ['a', 'b'], marriage: '1980' }
			],
			events: [
				{
					id: 'm-late',
					entityType: 'FAMILY',
					entityId: 'late',
					type: 'MARR',
					dateRaw: '2001',
					dateSort: '2001-01-01'
				},
				{
					id: 'm-early',
					entityType: 'FAMILY',
					entityId: 'early',
					type: 'MARR',
					dateRaw: '1980',
					dateSort: '1980-01-01'
				}
			]
		});
		// treeRows also adds MARR events from `marriage`; drop those so only the dated ones above count.
		rows.events = rows.events.filter((e) => e.id.startsWith('m-'));
		const label = makeLabeler(rows, []);
		expect(label('unions', { id: 'early' })).toBe('Ann–Ben partnership (1st of 2, m. 1980)');
		expect(label('unions', { id: 'late' })).toBe('Ann–Ben partnership (2nd of 2, m. 2001)');
	});

	it('numbers records with one partner without claiming a chronology', () => {
		const rows = treeRows({
			people,
			unions: [
				{ id: 'x2', partners: ['a'] },
				{ id: 'x1', partners: ['a'] },
				{ id: 'full', partners: ['a', 'b'] }
			]
		});
		const label = makeLabeler(rows, []);
		expect(label('unions', { id: 'x1' })).toBe('Ann partnership (1 of 2)');
		expect(label('unions', { id: 'x2' })).toBe('Ann partnership (2 of 2)');
		expect(label('unions', { id: 'full' })).toBe('Ann–Ben partnership');
	});
});
