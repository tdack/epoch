/**
 * The vocabulary of relationships both sides read: how a parent link is classed and what state a
 * partnership is in. The server's domain model and the screens import it from here; shared/ never
 * imports from server/.
 */

export const PARENT_CHILD_TYPES = {
	BIOLOGICAL: 'biological',
	ADOPTIVE: 'adoptive',
	FOSTER: 'foster',
	GUARDIAN: 'guardian',
	UNKNOWN: 'unknown'
} as const;
export type ParentChildType = (typeof PARENT_CHILD_TYPES)[keyof typeof PARENT_CHILD_TYPES];

export const UNION_STATUSES = {
	ACTIVE: 'active',
	SEPARATED: 'separated',
	DIVORCED: 'divorced',
	ANNULLED: 'annulled',
	ENDED: 'ended'
} as const;
export type UnionStatus = (typeof UNION_STATUSES)[keyof typeof UNION_STATUSES];
