/** A date's inclusive bounds as `YYYY-MM-DD`; null where the date is open on that side. */
interface DateBounds {
	sortStart: string | null;
	sortEnd: string | null;
}

/** Whole years from one `YYYY-MM-DD` day to a later one; negative when `to` is earlier. */
function yearsBetween(from: string, to: string): number {
	const years = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
	return to.slice(5) < from.slice(5) ? years - 1 : years;
}

/**
 * How old someone born on `birth` was at `event`, as "aged 34", or "aged 33–34" when the dates
 * allow a range: the youngest pairs the latest birth with the earliest event, the oldest the reverse.
 * Null when either date is open on the side that matters (`BEF 1900`, `AFT 1900`, undated), or
 * the event is certainly before the birth, so a wrong or one-sided date never shows a made-up age.
 */
export function ageAt(birth: DateBounds, event: DateBounds): string | null {
	if (!birth.sortStart || !birth.sortEnd || !event.sortStart || !event.sortEnd) return null;
	const oldest = yearsBetween(birth.sortStart, event.sortEnd);
	if (oldest < 0) return null;
	const youngest = Math.max(0, yearsBetween(birth.sortEnd, event.sortStart));
	if (oldest === 0) return 'aged under 1';
	return youngest === oldest ? `aged ${oldest}` : `aged ${youngest}–${oldest}`;
}

/**
 * Every recorded birth's bounds as one span, so conflicting births widen the age range rather
 * than one of them being picked; open when any dated birth is open on that side. Undated births
 * say nothing and are skipped. Null when no birth is dated.
 */
export function birthSpan(
	facts: readonly (DateBounds & { type: string; dateText: string | null })[]
): DateBounds | null {
	const births = facts.filter((f) => f.type === 'BIRT' && f.dateText);
	if (births.length === 0) return null;
	const starts = births.map((b) => b.sortStart);
	const ends = births.map((b) => b.sortEnd);
	return {
		sortStart: starts.includes(null) ? null : starts.reduce((a, b) => (b! < a! ? b : a)),
		sortEnd: ends.includes(null) ? null : ends.reduce((a, b) => (b! > a! ? b : a))
	};
}
