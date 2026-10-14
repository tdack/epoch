/**
 * What a tree search asks and what it answers with. Shared so the page, the focus box and the
 * relationship dialog read one shape, and so the URL's own parameters are parsed in one place.
 */

import type { PrivacyFlag } from './privacy';

/** Words past this are ignored: every word costs bound parameters, and D1 allows 100 a statement. */
const MAX_SEARCH_WORDS = 6;
export const DEFAULT_SEARCH_LIMIT = 25;
export const MAX_SEARCH_LIMIT = 100;

export interface SearchQuery {
	/** Free text: any word of any name, or an XREF such as `@I12@` or `I12`. */
	text: string;
	/** A substring of a fact's place. */
	place: string;
	/** Inclusive year or ISO date bounds on a fact's date; empty for unbounded. */
	from: string;
	to: string;
	limit: number;
	offset: number;
}

/** Why a person is in the results. One per thing that matched. */
export type SearchMatch =
	| {
			kind: 'name';
			/** The name as written, nickname and all. */
			text: string;
			nameType: string;
			/** False when the person is shown by a different name: "also known as". */
			isDisplayName: boolean;
	  }
	| { kind: 'xref'; text: string }
	| {
			kind: 'fact';
			factId: string;
			factType: string;
			label: string;
			placeText: string | null;
			dateText: string | null;
			/** True for a partnership's fact (a marriage) that reaches the person through it. */
			isPartnershipFact: boolean;
	  };

export interface SearchResultDto extends PrivacyFlag {
	id: string;
	displayName: string;
	givenName: string | null;
	surname: string | null;
	xref: string | null;
	birthDate: string | null;
	deathDate: string | null;
	isDeceased: boolean;
	matches: SearchMatch[];
	/** Set when the person matched through a name they are not shown by, for callers that only want the words. */
	matchedName?: string;
}

export interface SearchResponse {
	people: SearchResultDto[];
	hasMore: boolean;
}

const YEAR = /^\d{1,4}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A year becomes the first or last day of it, so a range of years reads the stored bounds. */
export function dateBound(text: string, edge: 'start' | 'end'): string | null {
	const value = text.trim();
	if (ISO_DATE.test(value)) return value;
	if (YEAR.test(value)) return `${value.padStart(4, '0')}-${edge === 'start' ? '01-01' : '12-31'}`;
	return null;
}

/**
 * The form a query word is matched in: canonical decomposition with the combining marks dropped and
 * lower-cased, so "müller" and "Muller" are one word. The name index folds the same way (its
 * tokenizer removes diacritics), which SQL cannot do for stored names (ADR-049). Folding is not
 * transliteration: "mueller" stays a different word.
 */
export function foldQuery(text: string): string {
	return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function searchWords(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/["“”]/g, ' ')
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, MAX_SEARCH_WORDS);
}

/** The URL's parameters as a query; anything unreadable is dropped rather than an error. */
export function parseSearchParams(params: { get(key: string): string | null }): SearchQuery {
	const int = (key: string, fallback: number, max: number) => {
		const n = Number.parseInt(params.get(key) ?? '', 10);
		return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback;
	};
	return {
		text: (params.get('q') ?? '').trim(),
		place: (params.get('place') ?? '').trim(),
		from: (params.get('from') ?? '').trim(),
		to: (params.get('to') ?? '').trim(),
		limit: Math.max(1, int('limit', DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT)),
		offset: int('offset', 0, 100_000)
	};
}
