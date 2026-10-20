/** "John Smith", or "Unknown" when the record has no name. Shared by the server's labels and the browser. */
export function personName(
	person: { givenName: string | null; surname: string | null } | undefined
): string {
	if (!person) return 'Unknown';
	return [person.givenName, person.surname].filter(Boolean).join(' ') || 'Unknown';
}

const BIRTH_MONTH_YEAR =
	/(?:\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+)?\b(\d{4})\b/i;

/**
 * Display names for a result list, where a name shared by several people gets their birth month
 * and year ("David Little (b. MAR 1812)") so they can be told apart. Unique names are left bare,
 * as are namesakes with no readable birth year; `nameOf` supplies each person's name.
 */
export function namesWithBirth<T extends { birthDate?: string | null }>(
	people: readonly T[],
	nameOf: (person: T) => string
): string[] {
	const names = people.map(nameOf);
	return people.map((p, i) => {
		if (names.filter((n) => n === names[i]).length < 2) return names[i];
		const match = BIRTH_MONTH_YEAR.exec(p.birthDate ?? '');
		if (!match) return names[i];
		return `${names[i]} (b. ${match[1] ? `${match[1].toUpperCase()} ` : ''}${match[2]})`;
	});
}
