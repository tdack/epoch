import { describe, expect, it } from 'vitest';
import { anniversariesAround, overviewStats } from './overview';
import { livingCutoff } from './living-state';
import { nextOccurrence } from '../../shared/overview';
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
			birthsByDecade: [
				{ decade: 1850, people: 1 },
				{ decade: 1900, people: 1 }
			],
			birthSpan: { earliest: { id: 'a', year: 1850 }, latest: { id: 'b', year: 1901 } },
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

	it('has no birth span without a birth dated to one year', () => {
		const stats = overviewStats(treeRows({ people: [{ id: 'a', birth: 'BET 1890 AND 1910' }] }));
		expect(stats.birthSpan).toBeNull();
		expect(stats.birthsByDecade).toEqual([]);
	});
});

describe('anniversariesAround', () => {
	const TODAY = '2026-10-26';
	const cutoff = livingCutoff(new Date(`${TODAY}T00:00:00Z`));
	const found = (spec: RowsSpec) =>
		anniversariesAround(treeRows(spec), TODAY, cutoff).map((a) => [a.id, a.isCurrent]);

	it('takes only exact Gregorian days near today', () => {
		expect(
			found({
				people: [
					{ id: 'a', birth: '26 OCT 1990' },
					{ id: 'b', birth: 'ABT 26 OCT 1900' },
					{ id: 'c', birth: 'OCT 1900' },
					{ id: 'd', birth: 'BEF 26 OCT 1900' },
					{ id: 'e', birth: '26 OCT 1900', death: '25 NOV 1970' },
					{ id: 'f', birth: '1 MAR 1900' }
				]
			})
		).toEqual([
			['birt-e', false],
			['birt-a', true],
			['deat-e', false]
		]);
	});

	it('marks a wedding only while both partners live and are not parted', () => {
		const spec = (extra: RowsSpec['events'] = []): RowsSpec => ({
			people: [
				{ id: 'a', birth: '1990' },
				{ id: 'b', birth: '1991' }
			],
			unions: [{ id: 'u', partners: ['a', 'b'], marriage: '1 NOV 2015' }],
			events: extra
		});
		const wedding = (s: RowsSpec) => found(s).find(([id]) => String(id).includes('u'));
		expect(wedding(spec())?.[1]).toBe(true);
		expect(
			wedding(spec([{ id: 'div', entityId: 'u', entityType: 'FAMILY', type: 'DIV' }]))?.[1]
		).toBe(false);
	});
});

describe('nextOccurrence', () => {
	it('counts days to the next one, crossing the year and keeping 29 February on the 28th', () => {
		expect(nextOccurrence('10-26', '2026-10-26')).toEqual({ days: 0, year: 2026 });
		expect(nextOccurrence('01-02', '2026-12-31')).toEqual({ days: 2, year: 2027 });
		expect(nextOccurrence('10-25', '2026-10-26').year).toBe(2027);
		expect(nextOccurrence('02-29', '2027-02-27')).toEqual({ days: 1, year: 2027 });
		expect(nextOccurrence('02-29', '2028-02-28')).toEqual({ days: 1, year: 2028 });
	});
});
