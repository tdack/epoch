/**
 * Ordering and conflict detection for a person's facts. Nothing is merged or hidden: two births
 * with different dates are both kept and both shown, flagged as a pair so a researcher sees the
 * disagreement instead of one silently winning.
 */

import { factTypeInfo } from './fact-types';

/** The parts of a fact the timeline needs; the person page maps its rows to this. */
export interface TimelineFact {
	id: string;
	type: string;
	dateText: string | null;
	/** Inclusive lower bound (`YYYY-MM-DD`), or null when undated. */
	sortStart: string | null;
	place: string | null;
	value: string | null;
	cause: string | null;
	age: string | null;
	notes: string | null;
	sortOrder: number;
}

/**
 * Dated facts in date order, then undated ones. Facts that tie on date keep the order the person
 * set (`sortOrder`), then the order they were recorded (the array order, which is insertion
 * order), so the timeline is stable and manual reordering has something to act on.
 */
export function sortTimeline<T extends TimelineFact>(facts: readonly T[]): T[] {
	return facts
		.map((fact, index) => ({ fact, index }))
		.sort((a, b) => {
			const [da, db] = [a.fact.sortStart, b.fact.sortStart];
			if (da !== db) {
				if (da === null) return 1;
				if (db === null) return -1;
				return da < db ? -1 : 1;
			}
			return a.fact.sortOrder - b.fact.sortOrder || a.index - b.index;
		})
		.map(({ fact }) => fact);
}

export const CONFLICT_KINDS = {
	/** A type a person has once, recorded more than once with different details. */
	CONFLICT: 'conflict',
	/** The same details recorded twice. */
	REPEAT: 'repeat'
} as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[keyof typeof CONFLICT_KINDS];

export interface FactConflict {
	kind: ConflictKind;
	/** The other facts of the same type it disagrees with, or repeats. */
	otherIds: string[];
}

const detailsOf = (fact: TimelineFact) =>
	[fact.dateText, fact.place, fact.value, fact.cause, fact.age, fact.notes]
		.map((part) => (part ?? '').trim().toLowerCase())
		.join('\u0000');

/**
 * Flags for the facts that disagree. Only types a person has once can conflict (two births);
 * having two residences or occupations is ordinary. Exact repeats of any type are flagged as
 * repeats, because they are almost always an import that ran twice.
 */
export function findFactConflicts(facts: readonly TimelineFact[]): Map<string, FactConflict> {
	const flags = new Map<string, FactConflict>();
	const byType = new Map<string, TimelineFact[]>();
	for (const fact of facts) byType.set(fact.type, [...(byType.get(fact.type) ?? []), fact]);

	for (const [type, group] of byType) {
		if (group.length < 2) continue;
		const distinct = new Set(group.map(detailsOf));
		const isSingular = factTypeInfo(type)?.isSingular ?? false;
		for (const fact of group) {
			const same = group.filter(
				(other) => other.id !== fact.id && detailsOf(other) === detailsOf(fact)
			);
			const differing = group.filter(
				(other) => other.id !== fact.id && detailsOf(other) !== detailsOf(fact)
			);
			if (same.length > 0)
				flags.set(fact.id, { kind: CONFLICT_KINDS.REPEAT, otherIds: same.map((o) => o.id) });
			else if (isSingular && distinct.size > 1)
				flags.set(fact.id, { kind: CONFLICT_KINDS.CONFLICT, otherIds: differing.map((o) => o.id) });
		}
	}
	return flags;
}
