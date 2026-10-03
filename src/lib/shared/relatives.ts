/**
 * A person's relatives, derived from a relationship graph: parents by family, partnerships with
 * their children, siblings split into full and half, and step-relatives. Only ids; the caller adds
 * names. Browser-safe and pure, so the server's person page and any client view agree by
 * construction, and a test can compare it against the whole tree.
 *
 * Nothing is inferred beyond what is recorded: a sibling is someone who shares a recorded parent,
 * "full" when they share exactly the same recorded parents, "half" when they share some.
 */

import type { ParentChildType, UnionStatus } from '../server/domain/genealogy-model';
import type { RelationshipGraph } from '../server/domain/relationship-graph';
import { startSort } from './partnership-labels';
import { stepRelativesOf, type StepRelatives } from './step-relatives';

interface ParentLink {
	personId: string;
	type: ParentChildType;
}

interface ParentFamily {
	/** Null for parents recorded without a partnership. */
	unionId: string | null;
	parents: ParentLink[];
}

interface ChildEntry {
	personId: string;
	/** Every type the child is asserted with across the partners in this group, without repeats. */
	types: ParentChildType[];
}

interface PartnershipRelatives {
	unionId: string;
	status: UnionStatus;
	/** The other partners, not the person. */
	partnerIds: string[];
	children: ChildEntry[];
}

export interface Relatives extends StepRelatives {
	parentFamilies: ParentFamily[];
	/** Oldest first where dated, otherwise as recorded. */
	partnerships: PartnershipRelatives[];
	/** Children recorded with no partnership. */
	directChildren: ChildEntry[];
	siblings: { full: string[]; half: string[] };
}

function addType(types: ParentChildType[], type: ParentChildType): ParentChildType[] {
	return types.includes(type) ? types : [...types, type];
}

function groupChildren(
	links: Array<{ childId: string; type: ParentChildType }>,
	except: string
): ChildEntry[] {
	const byChild = new Map<string, ParentChildType[]>();
	for (const link of links) {
		if (link.childId === except) continue;
		byChild.set(link.childId, addType(byChild.get(link.childId) ?? [], link.type));
	}
	return [...byChild].map(([personId, types]) => ({ personId, types }));
}

export function relativesOf(graph: RelationshipGraph, personId: string): Relatives {
	const person = graph.people.find((p) => p.id === personId);

	const parentFamilies: ParentFamily[] = Object.entries(person?.parentsByUnion ?? {}).map(
		([key, parents]) => ({
			unionId: key === '__direct__' ? null : key,
			parents: parents.map((p) => ({ personId: p.parentId, type: p.type }))
		})
	);

	const partnerships: PartnershipRelatives[] = graph.unions
		.filter((u) => u.partnerIds.includes(personId))
		.map((u) => ({
			unionId: u.id,
			status: u.status,
			partnerIds: u.partnerIds.filter((id) => id !== personId),
			children: groupChildren(
				u.children
					.filter((c) => c.parentId === personId)
					.map((c) => ({ childId: c.childId, type: c.type })),
				personId
			),
			events: u.events
		}))
		.sort((a, b) => {
			const [sa, sb] = [
				startSort({ id: '', partnerIds: [], events: a.events }),
				startSort({ id: '', partnerIds: [], events: b.events })
			];
			return sa && sb ? sa.localeCompare(sb) : sa ? -1 : sb ? 1 : 0;
		})
		.map(({ events: _events, ...rest }) => rest);

	const directChildren = groupChildren(
		graph.parentChild.filter((l) => l.parentId === personId && l.unionId === null),
		personId
	);

	// Siblings: everyone who shares a recorded parent, split by whether the parents match exactly.
	const parentsOf = new Map<string, Set<string>>();
	for (const link of graph.parentChild)
		parentsOf.set(link.childId, (parentsOf.get(link.childId) ?? new Set()).add(link.parentId));
	const own = parentsOf.get(personId) ?? new Set<string>();
	const siblings = { full: [] as string[], half: [] as string[] };
	if (own.size > 0) {
		const candidates = new Set(
			graph.parentChild
				.filter((l) => own.has(l.parentId) && l.childId !== personId)
				.map((l) => l.childId)
		);
		for (const id of candidates) {
			const theirs = parentsOf.get(id)!;
			const isFull = theirs.size === own.size && [...theirs].every((p) => own.has(p));
			(isFull ? siblings.full : siblings.half).push(id);
		}
	}

	return {
		parentFamilies,
		partnerships,
		directChildren,
		siblings,
		...stepRelativesOf(graph, personId)
	};
}
