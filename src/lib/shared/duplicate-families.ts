/**
 * What an import preview says about families the file repeats. The detection stays on the server;
 * only the report's shape lives here.
 */

export const POSSIBLE_DUPLICATE_REASONS = {
	DIFFERENT_FACTS: 'different_facts',
	DIFFERENT_CHILD_RECORDS: 'different_child_records',
	SUBSET_OF_FULL_FAMILY: 'subset_of_full_family',
	SAME_SINGLE_PARTNER: 'same_single_partner'
} as const;

type PossibleDuplicateReason =
	(typeof POSSIBLE_DUPLICATE_REASONS)[keyof typeof POSSIBLE_DUPLICATE_REASONS];

export interface ExactDuplicateGroup {
	/** The family that stays, then the ones merged into it. */
	familyIds: string[];
	survivorId: string;
	partners: string[];
	/** Distinct children once merged. */
	childCount: number;
}

export interface PossibleDuplicateGroup {
	familyIds: string[];
	reason: PossibleDuplicateReason;
	partners: string[];
}

export interface DuplicateFamilyReport {
	exact: ExactDuplicateGroup[];
	possible: PossibleDuplicateGroup[];
}
