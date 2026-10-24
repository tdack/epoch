import type { FactDto } from '#lib/shared/person-page.js';

/** Event types whose sub-type is part of their kind, e.g. "Other event (Anniversary)" (ADR-051). */
const QUALIFIED_TYPES: ReadonlySet<string> = new Set(['EVEN', 'FACT']);

/** The fact's sub-type, or null when there is none or it only repeats the label. */
function subTypeOf(fact: FactDto): string | null {
	const subType = fact.classification?.trim();
	return subType && subType.toLowerCase() !== fact.label.toLowerCase() ? subType : null;
}

export interface FactMember {
	fact: FactDto;
	/** The fact's place in `dto.facts`, which is what the reorder request sends. */
	index: number;
}

export interface FactGroup {
	key: string;
	label: string;
	/** Newest first; see `newestFirst`. */
	members: FactMember[];
	/** Any fact in the group disagrees or repeats another; the group then never collapses. */
	isConflicting: boolean;
}

/**
 * Facts of one kind group together; only a custom event's sub-type is part of its kind, so a
 * "Birth (Registered)" still sits, and conflicts, with the other births.
 */
export function groupKeyOf(fact: FactDto): string {
	return JSON.stringify([fact.type, QUALIFIED_TYPES.has(fact.type) ? subTypeOf(fact) : null]);
}

export function groupLabelOf(fact: FactDto): string {
	const subType = QUALIFIED_TYPES.has(fact.type) ? subTypeOf(fact) : null;
	return subType ? `${fact.label} (${subType})` : fact.label;
}

/** A fact's own heading, with any sub-type, e.g. "Occupation (Apprentice)". */
export function factLabelOf(fact: FactDto): string {
	const subType = subTypeOf(fact);
	return subType ? `${fact.label} (${subType})` : fact.label;
}

/** The sub-type a grouped fact shows on its own row, since its group heading does not carry it. */
export function memberSubTypeOf(fact: FactDto): string | null {
	return QUALIFIED_TYPES.has(fact.type) ? null : subTypeOf(fact);
}

/**
 * Newest first: a later date first, an undated fact last. Facts that share a date keep the later
 * one first, so the list reads as the timeline does and the newest shown is the last in the file.
 */
function newestFirst(a: FactMember, b: FactMember): number {
	const [sa, sb] = [a.fact.sortStart, b.fact.sortStart];
	if (sa !== sb) {
		if (sa === null) return 1;
		if (sb === null) return -1;
		return sa < sb ? 1 : -1;
	}
	return b.index - a.index;
}

/**
 * One group per kind of fact, in the order each kind first appears, its members newest first
 * (ADR-053). `include` picks which facts take part; each keeps its index into the full list.
 */
export function groupFacts(
	facts: readonly FactDto[],
	include: (fact: FactDto) => boolean = () => true
): FactGroup[] {
	const byKey = new Map<string, FactGroup>();
	facts.forEach((fact, index) => {
		if (!include(fact)) return;
		const key = groupKeyOf(fact);
		let group = byKey.get(key);
		if (!group) {
			group = { key, label: groupLabelOf(fact), members: [], isConflicting: false };
			byKey.set(key, group);
		}
		group.members.push({ fact, index });
		if (fact.conflict) group.isConflicting = true;
	});
	return [...byKey.values()].map((group) => ({
		...group,
		members: [...group.members].sort(newestFirst)
	}));
}
