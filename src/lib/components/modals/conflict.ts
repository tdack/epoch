/** One field where what the person typed and what is stored now differ. */
export interface ConflictRow {
	label: string;
	yours: string;
	current: string;
}

/** A stored value as text: the conflict payload is untyped, and only a string can be compared. */
export function storedText(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

/** Rows for the fields whose values differ; identical fields are not worth the reader's attention. */
export function differingRows(
	fields: Array<{
		label: string;
		yours: string | null | undefined;
		current: string | null | undefined;
	}>
): ConflictRow[] {
	return fields
		.map((f) => ({
			label: f.label,
			yours: (f.yours ?? '').trim(),
			current: (f.current ?? '').trim()
		}))
		.filter((row) => row.yours !== row.current);
}
