/**
 * Derived widowhood. Death never edits a union, so "widowed" is never stored: it is what the
 * union's status and the partners' deaths imply. A partner is widowed in a union that has not
 * ended when another partner has died and they have not.
 */

import type { UnionStatus } from './relationship-model';

export interface WidowhoodUnion {
	id: string;
	status: UnionStatus;
	partnerIds: string[];
}

export interface Widowhood {
	unionId: string;
	widowId: string;
	/** The partner whose death makes `widowId` a widow(er). */
	deceasedId: string;
}

export function widowhoods(
	unions: WidowhoodUnion[],
	deceasedIds: ReadonlySet<string>
): Widowhood[] {
	const found: Widowhood[] = [];
	for (const union of unions) {
		// An ended union stays ended: a divorced partner's death does not make anyone a widow.
		if (union.status !== 'active') continue;
		for (const widowId of union.partnerIds) {
			if (deceasedIds.has(widowId)) continue;
			for (const deceasedId of union.partnerIds) {
				if (deceasedId !== widowId && deceasedIds.has(deceasedId)) {
					found.push({ unionId: union.id, widowId, deceasedId });
				}
			}
		}
	}
	return found;
}

/** The widowhoods that recording `personId` as deceased would newly create. */
export function newWidowhoods(
	unions: WidowhoodUnion[],
	deceasedIds: ReadonlySet<string>,
	personId: string
): Widowhood[] {
	if (deceasedIds.has(personId)) return [];
	const key = (w: Widowhood) => `${w.unionId}|${w.widowId}|${w.deceasedId}`;
	const before = new Set(widowhoods(unions, deceasedIds).map(key));
	return widowhoods(unions, new Set([...deceasedIds, personId])).filter((w) => !before.has(key(w)));
}
