export const DESCENDANT_NUMBERINGS = { DABOVILLE: 'daboville', HENRY: 'henry' } as const;
export type DescendantNumbering =
	(typeof DESCENDANT_NUMBERINGS)[keyof typeof DESCENDANT_NUMBERINGS];

export const DESCENDANT_NUMBERING_LABELS: Readonly<Record<DescendantNumbering, string>> = {
	[DESCENDANT_NUMBERINGS.DABOVILLE]: "d'Aboville (1.2.1)",
	[DESCENDANT_NUMBERINGS.HENRY]: 'Henry (121)'
};

/**
 * A descendant's number in an outline. `path` holds the 1-based birth-order index of each child
 * from the root down, so `[]` is the root and `[2, 1]` is the root's second child's first child.
 */
export function descendantNumber(path: readonly number[], numbering: DescendantNumbering): string {
	for (const index of path) {
		if (!Number.isInteger(index) || index < 1) {
			throw new RangeError(`Child index must be a positive integer, got ${index}`);
		}
	}

	if (numbering === DESCENDANT_NUMBERINGS.DABOVILLE) {
		return ['1', ...path].join('.');
	}

	// Plain Henry numbers become ambiguous after nine children, so two-digit indexes get parentheses.
	return path.reduce((number, index) => number + (index < 10 ? `${index}` : `(${index})`), '1');
}
