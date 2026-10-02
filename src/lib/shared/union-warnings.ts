/**
 * Warnings for a partnership page. Each one is a statement the record itself makes impossible or
 * odd, checked only against dates that rule it out: an approximate or partial date narrows what is
 * possible but is never read as an exact day, so "ABT 1900" against a birth in 1901 is not a
 * warning, and "1899" against a birth in 1901 is.
 *
 * Browser-safe and pure.
 */

import { DATE_QUALIFIERS, parseDateValue } from './date-value';
import { UNION_EVENT_TYPES } from './union-events';

export const UNION_WARNING_CODES = {
	NO_PARTNERS: 'no_partners',
	SINGLE_PARTNER: 'single_partner',
	MERGEABLE_TWIN: 'mergeable_twin',
	PARTNER_DIED: 'partner_died',
	EVENT_BEFORE_BIRTH: 'event_before_birth',
	START_AFTER_DEATH: 'start_after_death',
	END_BEFORE_START: 'end_before_start',
	CHILD_BEFORE_PARENT: 'child_before_parent'
} as const;
export type UnionWarningCode = (typeof UNION_WARNING_CODES)[keyof typeof UNION_WARNING_CODES];

export const WARNING_SEVERITIES = { WARNING: 'warning', INFO: 'info' } as const;
export type WarningSeverity = (typeof WARNING_SEVERITIES)[keyof typeof WARNING_SEVERITIES];

export interface UnionWarning {
	code: UnionWarningCode;
	severity: WarningSeverity;
	message: string;
	/** Ids of the people, or event, the message is about. */
	subjectIds: string[];
}

/** What is known of a date: the earliest and latest day it could be, either open. */
export interface DateBounds {
	earliest: string | null;
	latest: string | null;
}

export function boundsOf(dateText: string | null | undefined): DateBounds | null {
	if (!dateText?.trim()) return null;
	const value = parseDateValue(dateText);
	if (value.sortStart === null && value.sortEnd === null) return null;
	return {
		earliest: value.sortStart,
		// "AFT 1900" has no latest day; everything else ends where its upper bound says, or where it starts.
		latest: value.qualifier === DATE_QUALIFIERS.AFTER ? null : (value.sortEnd ?? value.sortStart)
	};
}

/** True only when `a` is certainly earlier than `b`. */
export function isCertainlyBefore(a: DateBounds | null, b: DateBounds | null): boolean {
	return a?.latest != null && b?.earliest != null && a.latest < b.earliest;
}

export interface WarningPerson {
	id: string;
	name: string;
	birth: DateBounds | null;
	death: DateBounds | null;
}

export interface WarningEvent {
	id: string;
	type: string;
	label: string;
	date: DateBounds | null;
}

export interface UnionWarningInput {
	status: string;
	partners: WarningPerson[];
	events: WarningEvent[];
	children: WarningPerson[];
	hasTwin: boolean;
}

const START_TYPES: string[] = [
	UNION_EVENT_TYPES.ENGAGEMENT,
	UNION_EVENT_TYPES.PARTNERSHIP_START,
	UNION_EVENT_TYPES.MARRIAGE
];
const END_TYPES: string[] = [
	UNION_EVENT_TYPES.SEPARATION,
	UNION_EVENT_TYPES.DIVORCE,
	UNION_EVENT_TYPES.ANNULMENT
];

export function unionWarnings(input: UnionWarningInput): UnionWarning[] {
	const found: UnionWarning[] = [];
	const add = (
		code: UnionWarningCode,
		severity: WarningSeverity,
		message: string,
		subjectIds: string[] = []
	) => found.push({ code, severity, message, subjectIds });

	if (input.partners.length === 0) {
		add(
			UNION_WARNING_CODES.NO_PARTNERS,
			WARNING_SEVERITIES.WARNING,
			'This partnership has no recorded partners.'
		);
	} else if (input.partners.length === 1) {
		add(
			UNION_WARNING_CODES.SINGLE_PARTNER,
			WARNING_SEVERITIES.INFO,
			`Only ${input.partners[0]!.name} is recorded. Whoever the other parent was, this record does not say.`,
			[input.partners[0]!.id]
		);
	}
	if (input.hasTwin) {
		add(
			UNION_WARNING_CODES.MERGEABLE_TWIN,
			WARNING_SEVERITIES.INFO,
			'Another partnership has exactly the same partners. If it is a copy, the two can be merged.'
		);
	}

	if (input.status === 'active') {
		for (const partner of input.partners.filter((p) => p.death !== null)) {
			add(
				UNION_WARNING_CODES.PARTNER_DIED,
				WARNING_SEVERITIES.INFO,
				`${partner.name} has died. The partnership is still recorded as active, which is how widowhood is shown; it is not ended by a death.`,
				[partner.id]
			);
		}
	}

	for (const event of input.events) {
		for (const partner of input.partners) {
			if (isCertainlyBefore(event.date, partner.birth)) {
				add(
					UNION_WARNING_CODES.EVENT_BEFORE_BIRTH,
					WARNING_SEVERITIES.WARNING,
					`${event.label} is dated before ${partner.name} was born.`,
					[event.id, partner.id]
				);
			}
			if (START_TYPES.includes(event.type) && isCertainlyBefore(partner.death, event.date)) {
				add(
					UNION_WARNING_CODES.START_AFTER_DEATH,
					WARNING_SEVERITIES.WARNING,
					`${event.label} is dated after ${partner.name} died.`,
					[event.id, partner.id]
				);
			}
		}
	}

	for (const end of input.events.filter((e) => END_TYPES.includes(e.type))) {
		for (const start of input.events.filter((e) => START_TYPES.includes(e.type))) {
			if (isCertainlyBefore(end.date, start.date)) {
				add(
					UNION_WARNING_CODES.END_BEFORE_START,
					WARNING_SEVERITIES.WARNING,
					`${end.label} is dated before ${start.label}.`,
					[end.id, start.id]
				);
			}
		}
	}

	for (const child of input.children) {
		for (const partner of input.partners) {
			if (isCertainlyBefore(child.birth, partner.birth)) {
				add(
					UNION_WARNING_CODES.CHILD_BEFORE_PARENT,
					WARNING_SEVERITIES.WARNING,
					`${child.name} is recorded as born before ${partner.name}.`,
					[child.id, partner.id]
				);
			}
		}
	}
	return found;
}
