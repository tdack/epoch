import { parseDateValue } from '#lib/shared/date-value.js';
import { FACT_KINDS } from '#lib/shared/fact-types.js';
import type { FactDto, PartnershipDto, PersonSummaryDto } from '#lib/shared/person-page.js';
import type { GraphUnionEvent } from '#lib/shared/relationship-graph.js';

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

export type LifeEntry = OwnEntry | UnionEntry;

/**
 * The person's life in date order: their own events and their partnerships' events, undated last.
 * Attributes (occupation, residence and the like) are not events and are left to the caller.
 *
 * `facts` must already be in timeline order, as the person page DTO sends them; this only merges.
 * A union event without a stored sort key is parsed from its text, so a row written before the
 * date columns existed still lands in the right year. A tie keeps the person's own event first.
 */
export function lifeTimeline(
	facts: readonly FactDto[],
	partnerships: readonly PartnershipDto[]
): LifeEntry[] {
	const own: OwnEntry[] = facts
		.map((fact, index) => ({ kind: 'fact' as const, fact, index }))
		// Anything not known to be an attribute is placed as an event, so no fact can drop out of view.
		.filter((entry) => entry.fact.kind !== FACT_KINDS.ATTRIBUTE);
	const unions = partnerships
		.flatMap((p) =>
			p.events.map((event) => ({
				entry: {
					kind: 'union' as const,
					event,
					unionId: p.unionId,
					partners: p.partners
				},
				sort: event.dateSort ?? parseDateValue(event.dateText).sortStart ?? null
			}))
		)
		.sort((a, b) => compareSort(a.sort, b.sort));

	const merged: LifeEntry[] = [];
	let u = 0;
	for (const entry of own) {
		while (u < unions.length && compareSort(unions[u]!.sort, entry.fact.sortStart) < 0) {
			merged.push(unions[u++]!.entry);
		}
		merged.push(entry);
	}
	for (; u < unions.length; u++) merged.push(unions[u]!.entry);
	return merged;
}

/** Earlier first, undated last; equal keys compare equal so a stable sort keeps their order. */
function compareSort(a: string | null, b: string | null): number {
	if (a === b) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return a < b ? -1 : 1;
}
