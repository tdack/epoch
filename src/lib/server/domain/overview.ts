/**
 * The Overview page's figures from a tree's rows. Pure: callers pass the rows the viewer may see, so
 * a hidden person is never counted, and a date only counts where it pins the year it is read for.
 */

import type { EventRow, TreeRows } from './change-log';
import { personName } from './tree-ops';
import type { OverviewStatsDto } from '../../shared/overview';

const TOP_SURNAMES = 5;
/** Past this a lifespan is bad data, the same bound as the quality rule's. */
const MAX_LIFESPAN_YEARS = 120;

/** The one year a dated fact falls in; null when its bounds are open or span more than a year. */
function yearOf(e: EventRow | undefined): number | null {
	if (!e?.dateSort || !e.dateSortEnd) return null;
	const year = Number(e.dateSort.slice(0, 4));
	return year === Number(e.dateSortEnd.slice(0, 4)) ? year : null;
}

export function overviewStats(rows: TreeRows): OverviewStatsDto {
	const firstOf = (type: string) => {
		const found = new Map<string, EventRow>();
		for (const e of rows.events)
			if (e.entityType === 'INDIVIDUAL' && e.type === type && !found.has(e.entityId))
				found.set(e.entityId, e);
		return found;
	};
	const births = firstOf('BIRT');
	const deaths = firstOf('DEAT');

	const centuries = new Map<number, number>();
	const lifespans: { id: string; name: string; years: number }[] = [];
	const surnames = new Map<string, number>();
	for (const person of rows.individuals) {
		const born = yearOf(births.get(person.id));
		if (born !== null) {
			const century = Math.floor(born / 100) * 100;
			centuries.set(century, (centuries.get(century) ?? 0) + 1);
			const died = yearOf(deaths.get(person.id));
			if (died !== null && died >= born && died - born <= MAX_LIFESPAN_YEARS)
				lifespans.push({ id: person.id, name: personName(person), years: died - born });
		}
		const surname = person.surname?.trim();
		if (surname) surnames.set(surname, (surnames.get(surname) ?? 0) + 1);
	}

	return {
		people: rows.individuals.length,
		partnerships: rows.unions.length,
		birthsByCentury: [...centuries]
			.sort(([a], [b]) => a - b)
			.map(([century, people]) => ({ century, people })),
		averageLifespanYears:
			lifespans.length === 0
				? null
				: Math.round(lifespans.reduce((sum, l) => sum + l.years, 0) / lifespans.length),
		oldest: lifespans.reduce<(typeof lifespans)[number] | null>(
			(best, l) => (best === null || l.years > best.years ? l : best),
			null
		),
		topSurnames: [...surnames]
			.sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
			.slice(0, TOP_SURNAMES)
			.map(([surname, people]) => ({ surname, people }))
	};
}
