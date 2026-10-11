/** "John Smith", or "Unknown" when the record has no name. Shared by the server's labels and the browser. */
export function personName(
	person: { givenName: string | null; surname: string | null } | undefined
): string {
	if (!person) return 'Unknown';
	return [person.givenName, person.surname].filter(Boolean).join(' ') || 'Unknown';
}
