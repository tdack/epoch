/**
 * Which partnerships can be merged with a given one, and which to keep by default. Pure so the
 * dialog's starting state can be tested without a DOM.
 */

import type { PartnershipLabel } from '#lib/shared/partnership-labels.js';
import { partnerSetKey } from '#lib/shared/union-merge.js';

export { mergeableUnionIds } from '#lib/shared/union-merge.js';
import type { RelationshipGraphUnion } from '#lib/server/domain/relationship-graph.js';

export interface MergeCandidate {
	id: string;
	/** "2nd partnership (m. 1990)" */
	title: string;
	childCount: number;
	/** Version to send back, so a partnership edited meanwhile is a conflict rather than overwritten. */
	version: number;
}

const childCountOf = (union: RelationshipGraphUnion) =>
	new Set(union.children.map((c) => c.childId)).size;

/**
 * The union itself and every other union with exactly the same partners, oldest first. Empty when
 * it has no such twin, because a lone partnership has nothing to merge with.
 */
export function mergeCandidatesFor(
	unions: RelationshipGraphUnion[],
	unionId: string,
	labels: Map<string, PartnershipLabel>
): MergeCandidate[] {
	const target = unions.find((u) => u.id === unionId);
	if (!target || target.partnerIds.length === 0) return [];
	const key = partnerSetKey(target.partnerIds);
	const group = unions.filter((u) => partnerSetKey(u.partnerIds) === key);
	if (group.length < 2) return [];
	// Without a chronology (one recorded partner) the records are only told apart by number.
	return [...group]
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((u, index, all) => ({
			id: u.id,
			title: labels.get(u.id)?.full ?? `Partnership ${index + 1} of ${all.length}`,
			childCount: childCountOf(u),
			version: u.version ?? 0,
			position: labels.get(u.id)?.position ?? Number.MAX_SAFE_INTEGER
		}))
		.sort((a, b) => a.position - b.position)
		.map(({ position: _position, ...candidate }) => candidate);
}

/** The partnership with the most children survives by default, earliest first on a tie. */
export function defaultSurvivor(candidates: MergeCandidate[]): string {
	return [...candidates].sort((a, b) => b.childCount - a.childCount)[0]?.id ?? '';
}
