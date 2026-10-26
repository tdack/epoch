import { parseDateValue } from '#lib/shared/date-value.js';
import { FACT_KINDS } from '#lib/shared/fact-types.js';
import type { FactDto, PartnershipDto, PersonSummaryDto } from '#lib/shared/person-page.js';
import type { GraphUnionEvent } from '#lib/shared/relationship-graph.js';
import type { ParentChildType } from '#lib/shared/relationship-model.js';

/** One of the person's own events, with its place in `dto.facts` for the reorder request. */
interface OwnEntry {
	kind: 'fact';
	fact: FactDto;
	index: number;
}

/** A marriage, divorce or other event of one of the person's partnerships. */
interface UnionEntry {
	kind: 'union';
	event: GraphUnionEvent;
	unionId: string;
	partners: PersonSummaryDto[];
}

/** The birth of one of the person's children, by any kind of parentage. */
interface ChildEntry {
	kind: 'child';
	child: PersonSummaryDto;
	types: ParentChildType[];
}

export type LifeEntry = OwnEntry | UnionEntry | ChildEntry;

type Child = { person: PersonSummaryDto; types: ParentChildType[] };

/**
 * The person's life in date order: their own events, their partnerships' events and their
 * children's recorded births, undated last. Attributes (occupation, residence and the like) are
 * not events and are left to the caller. A child without a recorded birth, or hidden from the
 * viewer, has no entry, so the timeline never says a hidden child exists.
 *
 * `facts` must already be in timeline order, as the person page DTO sends them; this only merges.
 * A union event without a stored sort key is parsed from its text, so a row written before the
 * date columns existed still lands in the right year. A tie keeps the person's own event first,
 * then partnership events, then births.
 */
export function lifeTimeline(
	facts: readonly FactDto[],
	partnerships: readonly PartnershipDto[],
	directChildren: readonly Child[] = []
): LifeEntry[] {
	const own: OwnEntry[] = facts
		.map((fact, index) => ({ kind: 'fact' as const, fact, index }))
		// Anything not known to be an attribute is placed as an event, so no fact can drop out of view.
		.filter((entry) => entry.fact.kind !== FACT_KINDS.ATTRIBUTE);
	const children = new Map<string, Child>();
	for (const c of [...partnerships.flatMap((p) => p.children), ...directChildren])
		if (!c.person.isPrivate && c.person.birthDate) children.set(c.person.id, c);
	const others: Array<{ entry: UnionEntry | ChildEntry; sort: string | null }> = [
		...partnerships.flatMap((p) =>
			p.events.map((event) => ({
				entry: {
					kind: 'union' as const,
					event,
					unionId: p.unionId,
					partners: p.partners
				},
				sort: event.dateSort ?? parseDateValue(event.dateText).sortStart ?? null
			}))
		),
		...[...children.values()].map(({ person, types }) => ({
			entry: { kind: 'child' as const, child: person, types },
			sort: person.birthSort
		}))
	].sort((a, b) => compareSort(a.sort, b.sort));

	const merged: LifeEntry[] = [];
	let u = 0;
	for (const entry of own) {
		while (u < others.length && compareSort(others[u]!.sort, entry.fact.sortStart) < 0) {
			merged.push(others[u++]!.entry);
		}
		merged.push(entry);
	}
	for (; u < others.length; u++) merged.push(others[u]!.entry);
	return merged;
}

/** Earlier first, undated last; equal keys compare equal so a stable sort keeps their order. */
function compareSort(a: string | null, b: string | null): number {
	if (a === b) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return a < b ? -1 : 1;
}

/**
 * What a child is to the person, for "Birth of …": a son or daughter by default, an adopted or
 * foster one when that is the only link, and a ward under guardianship.
 */
export function childWord(child: PersonSummaryDto, types: readonly ParentChildType[]): string {
	const base = child.sex === 'M' ? 'son' : child.sex === 'F' ? 'daughter' : 'child';
	if (types.length === 0 || types.includes('biological') || types.includes('unknown')) return base;
	if (types.includes('adoptive')) return `adopted ${base}`;
	if (types.includes('foster')) return `foster ${base}`;
	return 'ward';
}
