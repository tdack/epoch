import type { TaskDto } from './tasks';

/** What a tree's Overview page shows: counts and spreads over the people the viewer may see. */
export interface OverviewStatsDto {
	people: number;
	partnerships: number;
	/** People per century of birth (`1800` holds 1800–1899), oldest first; births within one year only. */
	birthsByCentury: { century: number; people: number }[];
	/** Mean whole years between birth and death, over people whose both dates name a single year. */
	averageLifespanYears: number | null;
	oldest: { id: string; name: string; years: number } | null;
	/** The most carried display surnames, most first. */
	topSurnames: { surname: string; people: number }[];
}

export const ANNIVERSARY_TYPES = ['BIRT', 'MARR', 'DEAT'] as const;
export type AnniversaryType = (typeof ANNIVERSARY_TYPES)[number];

/** A birth, marriage or death recorded to an exact day, whose day falls near today. */
export interface AnniversaryDto {
	id: string;
	type: AnniversaryType;
	/** The recorded day as `MM-DD`. */
	monthDay: string;
	year: number;
	/** The person, or the partnership's partners. */
	people: { id: string; name: string }[];
	unionId: string | null;
	/** A living person's birthday, or the wedding of a couple both living and not parted. */
	isCurrent: boolean;
}

/** The viewer's own work in the tree; absent where their role has none of it. */
interface OverviewWorkDto {
	/** Open tasks given to the viewer, and how many there are; null for a non-member. */
	myTasks: { items: TaskDto[]; open: number } | null;
	/** The newest changes to the tree; null below editor, as the log names whoever a change touched. */
	recentChanges: { id: string; summary: string; createdAt: Date }[] | null;
}

export interface OverviewDto {
	stats: OverviewStatsDto;
	work: OverviewWorkDto;
	/**
	 * Days from the day before today to a month after, by the server's UTC clock: the reader picks
	 * today by their own, which can be a day either side.
	 */
	anniversaries: AnniversaryDto[];
}

/** How many days after today "Coming up" reaches. */
export const UPCOMING_DAYS = 30;

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * Days from `today` (local, `YYYY-MM-DD`) to the next time `monthDay` comes round, 0 for today,
 * and that year. A 29 February is kept on the 28th in other years.
 */
export function nextOccurrence(monthDay: string, today: string): { days: number; year: number } {
	const [year, month, day] = today.split('-').map(Number) as [number, number, number];
	const from = Date.UTC(year, month - 1, day);
	for (const y of [year, year + 1]) {
		const md = monthDay === '02-29' && !isLeapYear(y) ? '02-28' : monthDay;
		const at = Date.UTC(y, Number(md.slice(0, 2)) - 1, Number(md.slice(3)));
		if (at >= from) return { days: Math.round((at - from) / 86_400_000), year: y };
	}
	// Unreachable: a day of next year always comes after today.
	return { days: Infinity, year };
}
