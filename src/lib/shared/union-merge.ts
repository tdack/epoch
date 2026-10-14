/**
 * What two partnerships between the same people disagree about, and which side a person chose.
 *
 * Browser-safe: the server plans a merge with it and the merge dialog renders the same conflicts,
 * so what is shown as a conflict is exactly what the command refuses on.
 */

/**
 * A fact as the merge rules compare it. The detail fields are part of the identity: two facts that
 * differ only by an address are two facts, and a merge must not keep one and lose the other.
 */
export interface MergeFact {
	type: string;
	dateText: string | null;
	place: string | null;
	description: string | null;
	address: string | null;
	classification: string | null;
	agency: string | null;
	phone: string | null;
	email: string | null;
	fax: string | null;
	web: string | null;
	latitude: string | null;
	longitude: string | null;
	religion: string | null;
	/** The place's sub-lines, one string with a line break between each line. */
	placeExtra: string | null;
}

/** What a stored or parsed event holds, under the names both use. */
interface MergeFactSource {
	type: string;
	dateRaw?: string | null;
	place?: string | null;
	description?: string | null;
	address?: string | null;
	classification?: string | null;
	agency?: string | null;
	phone?: string | null;
	email?: string | null;
	fax?: string | null;
	web?: string | null;
	latitude?: string | null;
	longitude?: string | null;
	religion?: string | null;
	placeExtra?: string[] | null;
}

/** The fact the merge rules compare for this event. */
export function mergeFactOf(source: MergeFactSource): MergeFact {
	const text = (value: string | null | undefined) => value ?? null;
	return {
		type: source.type,
		dateText: text(source.dateRaw),
		place: text(source.place),
		description: text(source.description),
		address: text(source.address),
		classification: text(source.classification),
		agency: text(source.agency),
		phone: text(source.phone),
		email: text(source.email),
		fax: text(source.fax),
		web: text(source.web),
		latitude: text(source.latitude),
		longitude: text(source.longitude),
		religion: text(source.religion),
		placeExtra: source.placeExtra?.length ? source.placeExtra.join('\n') : null
	};
}

export interface MergeableUnion {
	id: string;
	status: string;
	facts: MergeFact[];
}

export type MergeConflict =
	| { kind: 'status'; options: Array<{ unionId: string; status: string }> }
	| { kind: 'event'; eventType: string; options: Array<{ unionId: string; facts: MergeFact[] }> };

/** For each conflicting thing, the id of the union whose value to keep. */
export interface MergeChoices {
	status?: string;
	/** Keyed by event type (`MARR`, `DIV`, ...). */
	events?: Record<string, string>;
}

const normalise = (value: string | null | undefined) =>
	(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Two facts are the same fact when their type, date, place and description read the same. */
export function factKey(fact: MergeFact): string {
	// JSON rather than a separator, so a value holding the separator cannot make two facts one.
	return JSON.stringify(
		[
			fact.type,
			fact.dateText,
			fact.place,
			fact.description,
			fact.address,
			fact.classification,
			fact.agency,
			fact.phone,
			fact.email,
			fact.fax,
			fact.web,
			fact.latitude,
			fact.longitude,
			fact.religion,
			fact.placeExtra
		].map(normalise)
	);
}

function signature(facts: MergeFact[]): string {
	return facts.map(factKey).sort().join('\n');
}

/** Partners as an unordered set: the same people in either order are the same partner set. */
export function partnerSetKey(partnerIds: readonly string[]): string {
	return [...new Set(partnerIds)].sort().join('::');
}

/**
 * A fact type or status is a conflict only when two unions both state it and differ. One side
 * silent is not a conflict: merging fills the gap.
 */
export function findMergeConflicts(unions: MergeableUnion[]): MergeConflict[] {
	const conflicts: MergeConflict[] = [];

	if (new Set(unions.map((u) => u.status)).size > 1) {
		conflicts.push({
			kind: 'status',
			options: unions.map((u) => ({ unionId: u.id, status: u.status }))
		});
	}

	const types = [...new Set(unions.flatMap((u) => u.facts.map((f) => f.type)))].sort();
	for (const eventType of types) {
		const stating = unions
			.map((u) => ({ unionId: u.id, facts: u.facts.filter((f) => f.type === eventType) }))
			.filter((option) => option.facts.length > 0);
		if (stating.length > 1 && new Set(stating.map((o) => signature(o.facts))).size > 1) {
			conflicts.push({ kind: 'event', eventType, options: stating });
		}
	}
	return conflicts;
}

/** The conflicts `choices` does not settle: no choice, or a choice of a union that has nothing to keep. */
export function unresolvedConflicts(
	conflicts: MergeConflict[],
	choices: MergeChoices | undefined
): MergeConflict[] {
	return conflicts.filter((conflict) => {
		const chosen =
			conflict.kind === 'status' ? choices?.status : choices?.events?.[conflict.eventType];
		return !chosen || !conflict.options.some((option) => option.unionId === chosen);
	});
}

/** Ids of every union that has at least one twin with exactly the same partners, one recorded partner included. */
export function mergeableUnionIds(
	unions: ReadonlyArray<{ id: string; partnerIds: string[] }>
): Set<string> {
	const groups = new Map<string, string[]>();
	for (const union of unions) {
		if (union.partnerIds.length === 0) continue;
		const key = partnerSetKey(union.partnerIds);
		groups.set(key, [...(groups.get(key) ?? []), union.id]);
	}
	return new Set([...groups.values()].filter((ids) => ids.length > 1).flat());
}
