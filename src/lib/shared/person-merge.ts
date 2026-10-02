/**
 * Merging two records of one person (Phase 5 item 5, ADR-022). Browser-safe: the dialog, the API
 * and the planner share these shapes.
 */

import type { Sex } from './sex';

/**
 * The most rows one merge writes. D1 counts each statement of a batch as a query with 1,000 allowed
 * per invocation, and a moved fact costs a version guard, a write and, for a place, a record
 * lookup; undo costs the same again. A person with more than this is refused, not half merged.
 */
export const MAX_PERSON_MERGE_OPS = 300;

/** Which of the two people's value to keep where they disagree. */
export type MergeSide = 'survivor' | 'merged';

export interface PersonMergeChoices {
	/** Needed only when both people have a sex recorded and they differ. */
	sex?: MergeSide;
}

export interface PersonMergeConflict {
	kind: 'sex';
	survivor: Sex;
	merged: Sex;
}

/** Why two people cannot be the same person, in words for the dialog. */
export const PERSON_MERGE_REFUSALS = {
	SAME_PERSON: 'Choose two different people.',
	ANCESTOR: 'One of them is recorded as an ancestor of the other, so they cannot be the same person.',
	SAME_PARTNERSHIP: 'They are the two partners of one partnership, so they cannot be the same person.'
} as const;
