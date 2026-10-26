/**
 * The events a partnership can carry in the editor, and how a status pairs with them.
 *
 * GEDCOM 5.5.1 has tags for engagement, banns, contract, licence, settlement, marriage, divorce
 * filed, divorce and annulment but none for the start of an unmarried partnership or for a
 * separation. Those two use user-defined tags (`_PSTART`, `_SEPR`), which the importer treats as
 * family events so they survive a round trip through Epoch. A family `EVEN` is not offered: it
 * needs a free-text type the partnership editor has no field for, so it stays read-only.
 */

import type { UnionStatus } from './relationship-model';

export const UNION_EVENT_TYPES = {
	ENGAGEMENT: 'ENGA',
	BANNS: 'MARB',
	CONTRACT: 'MARC',
	LICENCE: 'MARL',
	SETTLEMENT: 'MARS',
	PARTNERSHIP_START: '_PSTART',
	MARRIAGE: 'MARR',
	SEPARATION: '_SEPR',
	DIVORCE_FILED: 'DIVF',
	DIVORCE: 'DIV',
	ANNULMENT: 'ANUL'
} as const;
export type UnionEventType = (typeof UNION_EVENT_TYPES)[keyof typeof UNION_EVENT_TYPES];

/** Editor order: the usual order things happen in. */
export const UNION_EVENT_TYPE_LIST = [
	UNION_EVENT_TYPES.ENGAGEMENT,
	UNION_EVENT_TYPES.BANNS,
	UNION_EVENT_TYPES.CONTRACT,
	UNION_EVENT_TYPES.LICENCE,
	UNION_EVENT_TYPES.SETTLEMENT,
	UNION_EVENT_TYPES.PARTNERSHIP_START,
	UNION_EVENT_TYPES.MARRIAGE,
	UNION_EVENT_TYPES.SEPARATION,
	UNION_EVENT_TYPES.DIVORCE_FILED,
	UNION_EVENT_TYPES.DIVORCE,
	UNION_EVENT_TYPES.ANNULMENT
] as const;

export const UNION_EVENT_LABELS: Record<UnionEventType, string> = {
	ENGA: 'Engagement',
	MARB: 'Marriage banns',
	MARC: 'Marriage contract',
	MARL: 'Marriage licence',
	MARS: 'Marriage settlement',
	_PSTART: 'Partnership start',
	MARR: 'Marriage',
	_SEPR: 'Separation',
	DIVF: 'Divorce filed',
	DIV: 'Divorce',
	ANUL: 'Annulment'
};

/** Short forms for the label under a union node. */
export const UNION_EVENT_ABBREVIATIONS: Record<UnionEventType, string> = {
	ENGA: 'engaged',
	MARB: 'banns',
	MARC: 'contract',
	MARL: 'licence',
	MARS: 'settlement',
	_PSTART: 'from',
	MARR: 'm.',
	_SEPR: 'sep.',
	DIVF: 'div. filed',
	DIV: 'div.',
	ANUL: 'annulled'
};

export function isUnionEventType(type: string): type is UnionEventType {
	return (UNION_EVENT_TYPE_LIST as readonly string[]).includes(type);
}

export const ENDED_UNION_STATUSES = [
	'separated',
	'divorced',
	'annulled',
	'ended'
] as const satisfies readonly UnionStatus[];
export type EndedUnionStatus = (typeof ENDED_UNION_STATUSES)[number];

export const UNION_STATUS_LABELS: Record<UnionStatus, string> = {
	active: 'Active',
	separated: 'Separated',
	divorced: 'Divorced',
	annulled: 'Annulled',
	ended: 'Ended'
};

/** The event people usually record alongside each ended status; `ended` has none. */
export const SUGGESTED_END_EVENT: Record<EndedUnionStatus, UnionEventType | null> = {
	separated: UNION_EVENT_TYPES.SEPARATION,
	divorced: UNION_EVENT_TYPES.DIVORCE,
	annulled: UNION_EVENT_TYPES.ANNULMENT,
	ended: null
};

/** Event types that mark a union's end, for the union label. */
export const END_EVENT_TYPES = [
	UNION_EVENT_TYPES.SEPARATION,
	UNION_EVENT_TYPES.DIVORCE,
	UNION_EVENT_TYPES.ANNULMENT
] as const;

/** One event as the union editor and the end-partnership form submit it. */
export interface UnionEventInput {
	/** The stored event's id, or null for a new one. */
	id: string | null;
	type: UnionEventType;
	/** The date as typed; kept verbatim, with a parsed sort key stored beside it. */
	dateText: string | null;
	place: string | null;
}
