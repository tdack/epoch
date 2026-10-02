/** "1850 – 1920", "b. 1850", "d. 1920" or "deceased" from the dates as written; empty when nothing is known. */
export function lifeDates(
	birthDate: string | null,
	deathDate: string | null,
	isDeceased: boolean
): string {
	if (birthDate && (deathDate || isDeceased)) return `${birthDate} – ${deathDate ?? 'deceased'}`;
	if (birthDate) return `b. ${birthDate}`;
	if (deathDate) return `d. ${deathDate}`;
	return isDeceased ? 'deceased' : '';
}
