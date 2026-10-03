/**
 * Focus subgraph selection: which people and unions the hourglass draws.
 *
 * One rule drives it. Whenever a union is drawn, all of its partners are drawn with it, so a
 * couple is never shown with a missing half. What a depth limit hides is only ever further
 * relatives, and each hidden group is represented by a "+N" stub instead of vanishing.
 */

import { buildIndex, type GraphIndex } from './graph-index.js';
import {
	DEFAULT_FOCUS_OPTIONS,
	PERSON_ROLES,
	STUB_KINDS,
	type FocusSelection,
	type FocusViewOptions,
	type PersonRole,
	type RelationshipGraph,
	type ResolvedFocusOptions,
	type SelectedPerson,
	type SelectedUnion,
	type SelectionExpansion,
	type SelectionStub
} from './types.js';

function resolveOptions(options: FocusViewOptions = {}): ResolvedFocusOptions {
	const clamp = (value: number | undefined, fallback: number) =>
		Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : fallback;
	return {
		ancestorDepth: clamp(options.ancestorDepth, DEFAULT_FOCUS_OPTIONS.ancestorDepth),
		descendantDepth: clamp(options.descendantDepth, DEFAULT_FOCUS_OPTIONS.descendantDepth),
		shouldIncludeSiblings:
			options.shouldIncludeSiblings ?? DEFAULT_FOCUS_OPTIONS.shouldIncludeSiblings,
		shouldIncludeStepFamilies:
			options.shouldIncludeStepFamilies ?? DEFAULT_FOCUS_OPTIONS.shouldIncludeStepFamilies,
		expandedStubIds: [...new Set(options.expandedStubIds ?? [])].sort()
	};
}

/**
 * @returns null when the focus person is not in the graph.
 */
export function selectFocusSubgraph(
	graph: RelationshipGraph,
	focusPersonId: string,
	options: FocusViewOptions = {},
	index: GraphIndex = buildIndex(graph)
): FocusSelection | null {
	if (!index.personById.has(focusPersonId)) return null;
	const opts = resolveOptions(options);

	const people = new Map<string, SelectedPerson>();
	const unions = new Map<string, SelectedUnion>();
	const stubs: SelectionStub[] = [];
	const collapsed = new Set<string>();
	const expansions: SelectionExpansion[] = [];
	const expanded = new Set(opts.expandedStubIds);

	/** @returns true when the person was newly drawn; false when they already were. */
	function place(id: string, generation: number, role: PersonRole): boolean {
		if (people.has(id)) return false;
		people.set(id, { id, generation, role });
		return true;
	}

	/** Like `place`, but a repeat visit means a second path to the same person. */
	function assign(id: string, generation: number, role: PersonRole): boolean {
		const isNew = place(id, generation, role);
		if (!isNew) collapsed.add(id);
		return isNew;
	}

	place(focusPersonId, 0, PERSON_ROLES.FOCUS);

	// ---- Ancestors: both parents of every union a drawn person is a child of ----
	const parentQueue = [focusPersonId];
	while (parentQueue.length > 0) {
		const childId = parentQueue.shift()!;
		const generation = people.get(childId)!.generation;
		const parentUnionIds = index.parentUnionIdsOfChild.get(childId) ?? [];
		const directParentIds = index.directParentIdsOfChild.get(childId) ?? [];

		const ancestorStubId = `stub:ancestors:${childId}`;
		if (generation <= -opts.ancestorDepth && !expanded.has(ancestorStubId)) {
			const hidden = new Set<string>();
			for (const unionId of parentUnionIds) {
				for (const partnerId of index.unionById.get(unionId)?.partnerIds ?? []) {
					if (!people.has(partnerId)) hidden.add(partnerId);
				}
			}
			for (const parentId of directParentIds) if (!people.has(parentId)) hidden.add(parentId);
			if (hidden.size > 0) {
				stubs.push({
					id: `stub:ancestors:${childId}`,
					kind: STUB_KINDS.ANCESTORS,
					personId: childId,
					unionId: null,
					count: hidden.size,
					generation: generation - 1
				});
			}
			continue;
		}

		if (
			generation <= -opts.ancestorDepth &&
			(parentUnionIds.length > 0 || directParentIds.length > 0)
		) {
			expansions.push({
				stubId: ancestorStubId,
				kind: STUB_KINDS.ANCESTORS,
				personId: childId,
				unionId: null
			});
		}

		for (const unionId of parentUnionIds) {
			const union = index.unionById.get(unionId);
			if (!union) continue;
			if (unions.has(unionId)) {
				// A second child reaches an already drawn union: pedigree collapse.
				for (const partnerId of union.partnerIds) collapsed.add(partnerId);
				continue;
			}
			unions.set(unionId, { id: unionId, generation: generation - 1 });
			for (const partnerId of union.partnerIds) {
				if (assign(partnerId, generation - 1, PERSON_ROLES.ANCESTOR)) parentQueue.push(partnerId);
			}
		}
		for (const parentId of directParentIds) {
			if (assign(parentId, generation - 1, PERSON_ROLES.ANCESTOR)) parentQueue.push(parentId);
		}
	}

	// ---- Siblings: other children of the focus person's drawn parent unions ----
	if (opts.shouldIncludeSiblings) {
		for (const unionId of index.parentUnionIdsOfChild.get(focusPersonId) ?? []) {
			if (!unions.has(unionId)) continue;
			for (const siblingId of index.childIdsOfUnion.get(unionId) ?? []) {
				place(siblingId, 0, PERSON_ROLES.SIBLING);
			}
		}
	}

	/** True when the person is in a union that has not been drawn yet. */
	function hasUndrawnUnion(personId: string): boolean {
		return (index.unionsOfPerson.get(personId) ?? []).some((u) => !unions.has(u.id));
	}

	// ---- Descendants, with every partner of every union they belong to ----
	// A step seed is a partner whose other families are drawn too; its partners are not seeds
	// themselves, so the walk widens by one hop rather than following remarriage chains.
	interface QueueEntry {
		id: string;
		isStepSeed: boolean;
	}
	const childQueue: QueueEntry[] = [{ id: focusPersonId, isStepSeed: false }];
	while (childQueue.length > 0) {
		const { id: parentId, isStepSeed } = childQueue.shift()!;
		const generation = people.get(parentId)!.generation;
		const isBelowLimit = generation < opts.descendantDepth;

		const visit = (unionId: string | null, childIds: string[]) => {
			const stubId = unionId ? `stub:children:${unionId}` : `stub:children:direct:${parentId}`;
			const isExpanded = !isBelowLimit && expanded.has(stubId);
			const canShowChildren = isBelowLimit || isExpanded;
			const hidden = new Set<string>();
			for (const childId of childIds) {
				if (canShowChildren) {
					if (assign(childId, generation + 1, PERSON_ROLES.DESCENDANT)) {
						childQueue.push({ id: childId, isStepSeed: false });
					}
				} else if (!people.has(childId)) {
					hidden.add(childId);
				}
			}
			if (isExpanded && childIds.length > 0) {
				expansions.push({ stubId, kind: STUB_KINDS.CHILDREN, personId: parentId, unionId });
			}
			if (hidden.size > 0) {
				stubs.push({
					id: stubId,
					kind: STUB_KINDS.CHILDREN,
					personId: parentId,
					unionId,
					count: hidden.size,
					generation: generation + 1
				});
			}
		};

		for (const union of index.unionsOfPerson.get(parentId) ?? []) {
			// A seed shares its union with the person who queued it; that union is already drawn.
			if (isStepSeed && unions.has(union.id)) continue;
			if (!unions.has(union.id)) unions.set(union.id, { id: union.id, generation });
			for (const partnerId of union.partnerIds) {
				const isNewPartner = place(partnerId, generation, PERSON_ROLES.PARTNER);
				if (isNewPartner && !isStepSeed) {
					const otherStubId = `stub:children:other:${partnerId}`;
					if (opts.shouldIncludeStepFamilies || expanded.has(otherStubId)) {
						childQueue.push({ id: partnerId, isStepSeed: true });
						if (!opts.shouldIncludeStepFamilies && hasUndrawnUnion(partnerId)) {
							expansions.push({
								stubId: otherStubId,
								kind: STUB_KINDS.CHILDREN,
								personId: partnerId,
								unionId: null
							});
						}
					}
				}
			}
			visit(union.id, index.childIdsOfUnion.get(union.id) ?? []);
		}
		visit(null, index.directChildIdsOfParent.get(parentId) ?? []);
	}

	// ---- Partners' other families are not drawn, but their children are counted ----
	for (const person of [...people.values()]) {
		if (person.role !== PERSON_ROLES.PARTNER) continue;
		const hidden = new Set<string>();
		for (const union of index.unionsOfPerson.get(person.id) ?? []) {
			if (unions.has(union.id)) continue;
			for (const childId of index.childIdsOfUnion.get(union.id) ?? []) {
				if (!people.has(childId)) hidden.add(childId);
			}
		}
		if (hidden.size > 0) {
			stubs.push({
				id: `stub:children:other:${person.id}`,
				kind: STUB_KINDS.CHILDREN,
				personId: person.id,
				unionId: null,
				count: hidden.size,
				generation: person.generation + 1
			});
		}
	}

	return {
		focusPersonId,
		options: opts,
		people: [...people.values()],
		unions: [...unions.values()],
		stubs,
		expansions,
		collapsedPersonIds: [...collapsed]
	};
}
