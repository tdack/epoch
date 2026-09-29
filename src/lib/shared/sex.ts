/**
 * The sex marker on a person, as GEDCOM's `SEX` records it: not gender identity and not a parent
 * role, both of which the model keeps separate. `X` is GEDCOM 7's "does not fit the typical
 * definition of only Male or only Female"; `U` is unknown or not recorded.
 */
export const SEX_VALUES = ['M', 'F', 'X', 'U'] as const;
export type Sex = (typeof SEX_VALUES)[number];

export const SEX_LABELS: Record<Sex, string> = {
	M: 'Male',
	F: 'Female',
	X: 'Other',
	U: 'Unknown'
};

export function isSex(value: unknown): value is Sex {
	return typeof value === 'string' && (SEX_VALUES as readonly string[]).includes(value);
}

/** The label for a stored value, treating anything unrecognised as unknown. */
export function sexLabel(value: unknown): string {
	return SEX_LABELS[isSex(value) ? value : 'U'];
}
