import { DEFAULT_DATE_FORMAT, displayDate, type DateFormat } from './date-display';

/** "1850 – 1920", "b. 1850", "d. 1920" or "deceased" in the tree's date format; empty when nothing is known. */
export function lifeDates(
	birthDate: string | null,
	deathDate: string | null,
	isDeceased: boolean,
	format: DateFormat = DEFAULT_DATE_FORMAT
): string {
	const birth = displayDate(birthDate, format);
	const death = displayDate(deathDate, format);
	if (birthDate && (deathDate || isDeceased)) return `${birth} – ${deathDate ? death : 'deceased'}`;
	if (birthDate) return `b. ${birth}`;
	if (deathDate) return `d. ${death}`;
	return isDeceased ? 'deceased' : '';
}
