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

export interface OverviewDto {
	stats: OverviewStatsDto;
}
