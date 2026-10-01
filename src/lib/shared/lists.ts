/** What the individuals, partnerships and surnames lists ask and answer with (Phase 3, S7). */

import type { PrivacyFlag } from './privacy';
import type { Sex } from './sex';

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 100;

export const INDIVIDUAL_SORTS = { SURNAME: 'surname', GIVEN: 'given' } as const;
export type IndividualSort = (typeof INDIVIDUAL_SORTS)[keyof typeof INDIVIDUAL_SORTS];

export interface ListQuery {
	offset: number;
	limit: number;
}

export interface IndividualListQuery extends ListQuery {
	sort: IndividualSort;
	/** Only people with a stored name, or a display name, whose surname is this (any case). */
	surname: string;
}

export interface IndividualListItem extends PrivacyFlag {
	id: string;
	displayName: string;
	givenName: string | null;
	surname: string | null;
	xref: string | null;
	sex: Sex | null;
	birthDate: string | null;
	deathDate: string | null;
	isDeceased: boolean;
}

export interface UnionListItem extends PrivacyFlag {
	id: string;
	status: string;
	partners: Array<{ id: string; displayName: string }>;
	/** The first marriage fact, as written; null when the partnership has none. */
	marriageDate: string | null;
	marriagePlace: string | null;
	endDate: string | null;
}

export interface SurnameListItem extends PrivacyFlag {
	surname: string;
	/** People with this surname on any stored name or as their display name; a person counts once. */
	people: number;
}

export interface Page<T> {
	items: T[];
	hasMore: boolean;
	offset: number;
	limit: number;
}

/** Offset and limit from a URL, clamped: a hand-edited address never asks for a huge page. */
export function parseListParams(params: { get(key: string): string | null }): ListQuery {
	const int = (key: string, fallback: number, max: number, min: number) => {
		const n = Number.parseInt(params.get(key) ?? '', 10);
		return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
	};
	return { offset: int('offset', 0, 1_000_000, 0), limit: int('limit', DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, 1) };
}
