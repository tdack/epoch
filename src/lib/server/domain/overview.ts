/**
 * The Overview page's figures from a tree's rows. Pure: callers pass the rows the viewer may see, so
 * a hidden person is never counted, and a date only counts where it pins the year it is read for.
 */

import type { EventRow, TreeRows } from './change-log';
import { isLikelyLiving, type LivingFact } from './living-state';
import { personName } from './tree-ops';
import {
	ANNIVERSARY_TYPES,
	UPCOMING_DAYS,
	type AnniversaryDto,
	type AnniversaryType,
	type OverviewStatsDto
} from '../../shared/overview';

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

/** A partnership with any of these has ended, so its wedding day is not one to mark. */
const PARTED_TYPES: ReadonlySet<string> = new Set(['DIV', 'DIVF', 'ANUL', '_SEPR']);

/** The `MM-DD` days from the day before `today` (UTC, `YYYY-MM-DD`) to `UPCOMING_DAYS` after it. */
function daysAround(today: string): Set<string> {
	const start = Date.parse(`${today}T00:00:00Z`);
	const days = new Set<string>();
	for (let i = -1; i <= UPCOMING_DAYS + 1; i++)
		days.add(new Date(start + i * 86_400_000).toISOString().slice(5, 10));
	// A 29 February is marked on the 28th in other years; the reader decides which year it is.
	if (days.has('02-28')) days.add('02-29');
	return days;
}

/**
 * Births, marriages and deaths recorded to one Gregorian day whose day falls around `today`. Only an
 * exact day counts: `ABT 1 MAR 1900` or `MAR 1900` would make up an anniversary. A dual-dated
 * (Julian) day is skipped, as its sort bound has moved to the following year's calendar.
 */
export function anniversariesAround(
	rows: TreeRows,
	today: string,
	cutoff: string
): AnniversaryDto[] {
	const window = daysAround(today);
	const people = new Map(rows.individuals.map((p) => [p.id, p]));
	const factsOf = new Map<string, LivingFact[]>();
	const parted = new Set<string>();
	for (const e of rows.events) {
		if (e.entityType === 'INDIVIDUAL')
			factsOf.set(e.entityId, [...(factsOf.get(e.entityId) ?? []), e]);
		else if (PARTED_TYPES.has(e.type)) parted.add(e.entityId);
	}
	const isLiving = (id: string) => isLikelyLiving(factsOf.get(id) ?? [], cutoff);
	const partnersOf = new Map<string, string[]>();
	for (const p of rows.unionPartners)
		partnersOf.set(p.unionId, [...(partnersOf.get(p.unionId) ?? []), p.personId]);

	const found: AnniversaryDto[] = [];
	for (const e of rows.events) {
		const type = e.type as AnniversaryType;
		if (!ANNIVERSARY_TYPES.includes(type) || !e.dateSort) continue;
		if (e.datePrecision !== 'DAY' || e.dateQualifier !== 'EXACT') continue;
		if (e.dateCalendar !== 'GREGORIAN' || !window.has(e.dateSort.slice(5))) continue;
		const isUnion = e.entityType === 'FAMILY';
		if (isUnion !== (type === 'MARR')) continue;
		const ids = isUnion ? (partnersOf.get(e.entityId) ?? []) : [e.entityId];
		const named = ids.flatMap((id) => {
			const person = people.get(id);
			return person ? [{ id, name: personName(person) }] : [];
		});
		if (named.length === 0) continue;
		found.push({
			id: e.id,
			type,
			monthDay: e.dateSort.slice(5),
			year: Number(e.dateSort.slice(0, 4)),
			people: named,
			unionId: isUnion ? e.entityId : null,
			isCurrent:
				type === 'BIRT'
					? isLiving(e.entityId)
					: type === 'MARR' && !parted.has(e.entityId) && ids.every(isLiving)
		});
	}
	return found.sort((a, b) => a.monthDay.localeCompare(b.monthDay) || a.year - b.year);
}
