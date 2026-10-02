/**
 * Chronological labels for repeated partnerships between the same people: "1st partnership",
 * "2nd partnership", with dates where known. Repetition then reads as intentional (a divorce and a
 * remarriage) instead of as a rendering fault. A pair with one partnership gets no label, and neither
 * does a partnership with a single recorded partner.
 *
 * Browser-safe: the drawer, the editor title, the canvas and the server's previews all use it.
 */

import { partnerSetKey } from './union-merge';
import { UNION_EVENT_ABBREVIATIONS, UNION_EVENT_TYPES, isUnionEventType } from './union-events';

export interface LabelableUnion {
	id: string;
	partnerIds: string[];
	events?: Array<{ type: string; dateText: string | null; dateSort?: string | null }>;
	/** Epoch milliseconds the partnership was recorded; orders undated partnerships. */
	createdAt?: number | null;
}

export interface PartnershipLabel {
	/** 1-based position among this pair's partnerships. */
	position: number;
	total: number;
	/** "2nd partnership" */
	title: string;
	/** "m. 1990 – div. 1995", or null when no date is known. */
	dates: string | null;
	/** "2nd partnership (m. 1990 – div. 1995)" */
	full: string;
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 21st. */
export function ordinal(n: number): string {
	const tens = n % 100;
	if (tens >= 11 && tens <= 13) return `${n}th`;
	return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

const START_TYPES = [
	UNION_EVENT_TYPES.ENGAGEMENT,
	UNION_EVENT_TYPES.PARTNERSHIP_START,
	UNION_EVENT_TYPES.MARRIAGE
] as string[];
const SUMMARY_START = [
	UNION_EVENT_TYPES.MARRIAGE,
	UNION_EVENT_TYPES.PARTNERSHIP_START,
	UNION_EVENT_TYPES.ENGAGEMENT
] as string[];
const SUMMARY_END = [
	UNION_EVENT_TYPES.DIVORCE,
	UNION_EVENT_TYPES.ANNULMENT,
	UNION_EVENT_TYPES.SEPARATION
] as string[];

/** The earliest sort key among the events that begin a partnership; null when none is dated. */
export function startSort(union: LabelableUnion): string | null {
	const keys = (union.events ?? [])
		.filter((e) => START_TYPES.includes(e.type) && e.dateSort)
		.map((e) => e.dateSort!)
		.sort();
	return keys[0] ?? null;
}

function firstDated(union: LabelableUnion, types: string[]) {
	for (const type of types) {
		const event = (union.events ?? []).find((e) => e.type === type && e.dateText);
		if (event) return event;
	}
	return null;
}

/** "m. 1990 – div. 1995": the start and the end, each only when it has a date. */
export function datesOf(union: LabelableUnion): string | null {
	const part = (types: string[]) => {
		const event = firstDated(union, types);
		return event && isUnionEventType(event.type)
			? `${UNION_EVENT_ABBREVIATIONS[event.type]} ${event.dateText}`
			: null;
	};
	const parts = [part(SUMMARY_START), part(SUMMARY_END)].filter(Boolean);
	return parts.length > 0 ? parts.join(' – ') : null;
}

/**
 * Labels for every union whose partner set recurs. Dated partnerships come first, oldest first;
 * undated ones follow in the order they were recorded, then by id, so the labels are stable between
 * renders and a preview agrees with the save (a new partnership always comes after existing ones).
 */
export function partnershipLabels(unions: LabelableUnion[]): Map<string, PartnershipLabel> {
	const groups = new Map<string, LabelableUnion[]>();
	for (const union of unions) {
		// One recorded partner says nothing about who the other was, so two such records are not
		// "the same pair" and no chronology is claimed for them.
		if (union.partnerIds.length < 2) continue;
		const key = partnerSetKey(union.partnerIds);
		groups.set(key, [...(groups.get(key) ?? []), union]);
	}

	const labels = new Map<string, PartnershipLabel>();
	for (const group of groups.values()) {
		if (group.length < 2) continue;
		const ordered = [...group].sort((a, b) => {
			const [sa, sb] = [startSort(a), startSort(b)];
			if (sa && sb) return sa === sb ? a.id.localeCompare(b.id) : sa.localeCompare(sb);
			if (sa || sb) return sa ? -1 : 1;
			if (a.createdAt != null && b.createdAt != null && a.createdAt !== b.createdAt)
				return a.createdAt - b.createdAt;
			return a.id.localeCompare(b.id);
		});
		ordered.forEach((union, index) => {
			const title = `${ordinal(index + 1)} partnership`;
			const dates = datesOf(union);
			labels.set(union.id, {
				position: index + 1,
				total: ordered.length,
				title,
				dates,
				full: dates ? `${title} (${dates})` : title
			});
		});
	}
	return labels;
}
