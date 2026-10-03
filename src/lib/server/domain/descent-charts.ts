/**
 * The ancestors and descendants of a person as the charts draw them (Phase 3 item 9). Pure, over
 * rows the caller has already masked for the viewer, so a hidden person is simply absent (or a
 * placeholder, when the tree shows its private structure).
 *
 * A pedigree has two parents to a person, so where a person has more than two recorded parents
 * (a birth and an adoptive pair) biological parents come first, then the rest, and the chart says
 * only as much as fits; the person page lists every one.
 */

import type { EventRow, TreeRows } from './change-log';
import type { ChartPerson, DescendantNode, PedigreeDto } from '../../shared/charts';
import type { ParentChildType } from '../../shared/relationship-model';
import { PRIVATE_PLACEHOLDER_NAME } from './privacy-mask';

const TYPE_ORDER: Record<ParentChildType, number> = {
	biological: 0,
	adoptive: 1,
	foster: 2,
	guardian: 3,
	unknown: 4
} as Record<ParentChildType, number>;
const SEX_ORDER = { M: 0, F: 1 } as Record<string, number>;

function personNameOf(row: {
	id: string;
	givenName: string | null;
	surname: string | null;
}): string {
	return [row.givenName, row.surname].filter(Boolean).join(' ') || row.id;
}

export interface ChartContext {
	rows: TreeRows;
	/** People shown as "Private" placeholders. */
	placeholderIds: ReadonlySet<string>;
}

class ChartIndex {
	private people = new Map<string, ChartPerson>();
	private sexOf = new Map<string, string | null>();
	private firstDates = new Map<
		string,
		{ birth: string | null; death: string | null; sort: string | null }
	>();
	readonly parentsOf = new Map<string, Array<{ parentId: string; type: ParentChildType }>>();
	readonly childrenOf = new Map<
		string,
		Array<{ childId: string; type: ParentChildType; unionId: string | null }>
	>();
	readonly partnersOf = new Map<string, string[]>();

	constructor({ rows, placeholderIds }: ChartContext) {
		const eventsBy = new Map<string, EventRow[]>();
		for (const e of rows.events)
			if (e.entityType === 'INDIVIDUAL')
				(eventsBy.get(e.entityId) ?? eventsBy.set(e.entityId, []).get(e.entityId)!).push(e);
		for (const i of rows.individuals) {
			const own = eventsBy.get(i.id) ?? [];
			const first = (type: string) =>
				own
					.filter((e) => e.type === type)
					.sort((a, b) => (a.dateSort ?? '').localeCompare(b.dateSort ?? ''))[0];
			const birth = first('BIRT');
			const isPrivate = placeholderIds.has(i.id);
			this.firstDates.set(i.id, {
				birth: birth?.dateRaw ?? null,
				death: first('DEAT')?.dateRaw ?? null,
				sort: birth?.dateSort ?? null
			});
			this.sexOf.set(i.id, i.sex);
			this.people.set(i.id, {
				id: i.id,
				name: isPrivate ? PRIVATE_PLACEHOLDER_NAME : personNameOf(i),
				isPrivate,
				birth: isPrivate ? null : (birth?.dateRaw ?? null),
				death: isPrivate ? null : (first('DEAT')?.dateRaw ?? null)
			});
		}
		for (const l of rows.parentChild) {
			if (!this.people.has(l.parentId) || !this.people.has(l.childId)) continue;
			(this.parentsOf.get(l.childId) ?? this.parentsOf.set(l.childId, []).get(l.childId)!).push({
				parentId: l.parentId,
				type: l.type
			});
			(
				this.childrenOf.get(l.parentId) ?? this.childrenOf.set(l.parentId, []).get(l.parentId)!
			).push({ childId: l.childId, type: l.type, unionId: l.unionId });
		}
		const byUnion = new Map<string, string[]>();
		for (const p of rows.unionPartners)
			byUnion.set(p.unionId, [...(byUnion.get(p.unionId) ?? []), p.personId]);
		for (const members of byUnion.values()) {
			for (const a of members)
				for (const b of members)
					if (a !== b && this.people.has(b) && !this.partnersOf.get(a)?.includes(b))
						this.partnersOf.set(a, [...(this.partnersOf.get(a) ?? []), b]);
		}
	}

	person(id: string): ChartPerson | null {
		return this.people.get(id) ?? null;
	}

	sex(id: string): string | null {
		return this.sexOf.get(id) ?? null;
	}

	birthSort(id: string): string {
		return this.firstDates.get(id)?.sort ?? '9999';
	}

	/** At most two parents, biological first, then by sex (M, F) and id so the order is stable. */
	orderedParents(childId: string): string[] {
		const parents = [...(this.parentsOf.get(childId) ?? [])].sort(
			(a, b) =>
				TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
				(SEX_ORDER[this.sexOf.get(a.parentId) ?? ''] ?? 2) -
					(SEX_ORDER[this.sexOf.get(b.parentId) ?? ''] ?? 2) ||
				a.parentId.localeCompare(b.parentId)
		);
		return [...new Set(parents.map((p) => p.parentId))];
	}
}

/** The pedigree of `personId`, `generations` deep with the person themselves as the first. */
export function buildPedigree(
	context: ChartContext,
	personId: string,
	generations: number
): PedigreeDto | null {
	const index = new ChartIndex(context);
	const person = index.person(personId);
	if (!person) return null;
	const slotCount = 2 ** generations - 1;
	const slots: Array<ChartPerson | null> = new Array(slotCount).fill(null);
	const ids: Array<string | null> = new Array(slotCount).fill(null);
	slots[0] = person;
	ids[0] = personId;
	let hasMoreAbove = false;
	for (let i = 0; i < slotCount; i++) {
		const id = ids[i];
		if (!id) continue;
		const parents = index.orderedParents(id);
		const first = 2 * i + 1;
		if (first >= slotCount) {
			if (parents.length > 0) hasMoreAbove = true;
			continue;
		}
		// One recorded parent goes in the slot that suits their sex: a mother in the second.
		const [a, b] =
			parents.length === 1 && index.sex(parents[0]!) === 'F' ? [undefined, parents[0]] : parents;
		for (const [slot, parentId] of [
			[first, a],
			[first + 1, b]
		] as const) {
			if (!parentId) continue;
			ids[slot] = parentId;
			slots[slot] = index.person(parentId);
		}
	}
	return { person, generations, slots, hasMoreAbove };
}

/** The descendants of `personId` down `generations` levels, with the partners shown on each card. */
export function buildDescendants(
	context: ChartContext,
	personId: string,
	generations: number
): { root: DescendantNode; hasMoreBelow: boolean } | null {
	const index = new ChartIndex(context);
	if (!index.person(personId)) return null;
	let hasMoreBelow = false;

	function node(id: string, depth: number, path: ReadonlySet<string>): DescendantNode {
		const partners = (index.partnersOf.get(id) ?? []).map((p) => index.person(p)!).filter(Boolean);
		const childIds = [...new Set((index.childrenOf.get(id) ?? []).map((c) => c.childId))].filter(
			(c) => !path.has(c)
		);
		const children: DescendantNode[] = [];
		if (depth + 1 >= generations) {
			if (childIds.length > 0) hasMoreBelow = true;
		} else {
			const next = new Set(path).add(id);
			for (const childId of childIds.sort(
				(a, b) => index.birthSort(a).localeCompare(index.birthSort(b)) || a.localeCompare(b)
			))
				children.push(node(childId, depth + 1, next));
		}
		return { person: index.person(id)!, partners, children };
	}
	return { root: node(personId, 0, new Set()), hasMoreBelow };
}
