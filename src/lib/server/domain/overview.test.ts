import { describe, expect, it } from 'vitest';
import { overviewStats } from './overview';
import { treeRows as rawRows, type RowsSpec } from '../testing/rows';
import { dateColumnsFor } from './date-columns';

/** The rows as the store holds them: each date's parsed columns beside its text. */
function treeRows(spec: RowsSpec) {
	const rows = rawRows(spec);
	return { ...rows, events: rows.events.map((e) => ({ ...e, ...dateColumnsFor(e.dateRaw) })) };
}

describe('overviewStats', () => {
	it('counts by century and lifespan only from dates that pin a year', () => {
		const stats = overviewStats(
			treeRows({
				people: [
					{ id: 'a', givenName: 'Ann', surname: 'Hill', birth: '3 MAR 1850', death: '1920' },
					{ id: 'b', givenName: 'Bob', surname: 'Hill', birth: '1901', death: '1961' },
					{ id: 'c', surname: 'Ross', birth: 'BEF 1900', death: '1950' },
					{ id: 'd', surname: 'Ross', birth: 'BET 1890 AND 1910' },
					{ id: 'e', surname: 'Hill' }
				],
				unions: [{ id: 'u', partners: ['a', 'b'] }]
			})
		);
		expect(stats).toMatchObject({
			people: 5,
			partnerships: 1,
			birthsByCentury: [
				{ century: 1800, people: 1 },
				{ century: 1900, people: 1 }
			],
			averageLifespanYears: 65,
			oldest: { id: 'a', years: 70 },
			topSurnames: [
				{ surname: 'Hill', people: 3 },
				{ surname: 'Ross', people: 2 }
			]
		});
	});

	it('has no lifespan figures without a dated birth and death', () => {
		const stats = overviewStats(treeRows({ people: [{ id: 'a', birth: '1900' }] }));
		expect(stats.averageLifespanYears).toBeNull();
		expect(stats.oldest).toBeNull();
	});
});
