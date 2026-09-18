/**
 * Phase 1 neutral genealogy domain model.
 *
 * These types describe the target model (union/partner/parent-child) that
 * replaces the gendered `families`/`family_children` prototype schema. They are
 * intentionally free of GEDCOM interchange concerns (spouse roles, XREFs) which
 * belong to the import/export layer.
 */

import type { DateValue } from './date-value';

export const PARENT_CHILD_TYPES = {
	BIOLOGICAL: 'biological',
	ADOPTIVE: 'adoptive',
	FOSTER: 'foster',
	GUARDIAN: 'guardian',
	UNKNOWN: 'unknown'
} as const;
export type ParentChildType = (typeof PARENT_CHILD_TYPES)[keyof typeof PARENT_CHILD_TYPES];

export const PARENT_CHILD_STATUSES = {
	ACTIVE: 'active',
	ENDED: 'ended',
	DISPUTED: 'disputed'
} as const;
export type ParentChildStatus = (typeof PARENT_CHILD_STATUSES)[keyof typeof PARENT_CHILD_STATUSES];

export const UNION_STATUSES = {
	ACTIVE: 'active',
	SEPARATED: 'separated',
	DIVORCED: 'divorced',
	ANNULLED: 'annulled',
	ENDED: 'ended'
} as const;
export type UnionStatus = (typeof UNION_STATUSES)[keyof typeof UNION_STATUSES];

export const NAME_TYPES = {
	BIRTH: 'birth',
	MARRIED: 'married',
	AKA: 'aka',
	IMMIGRANT: 'immigrant',
	MAIDEN: 'maiden',
	PROFESSIONAL: 'professional',
	OTHER: 'other'
} as const;
export type NameType = (typeof NAME_TYPES)[keyof typeof NAME_TYPES];

export interface Person {
	id: string;
	treeId: string;
	version: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface PersonName {
	id: string;
	personId: string;
	type: NameType;
	givenName: string | null;
	surname: string | null;
	namePrefix: string | null;
	nameSuffix: string | null;
	/** True when this name is the preferred display name for the person. */
	isPreferred: boolean;
	order: number;
}

export interface Union {
	id: string;
	treeId: string;
	status: UnionStatus;
	version: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface UnionPartner {
	id: string;
	unionId: string;
	personId: string;
	/** Stable ordering of participants within the union. */
	order: number;
}

export interface ParentChild {
	id: string;
	treeId: string;
	parentId: string;
	childId: string;
	type: ParentChildType;
	status: ParentChildStatus;
	/** Optional union context; null for a direct assertion outside any union. */
	unionId: string | null;
	version: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface Event {
	id: string;
	treeId: string;
	/** The person or union this event belongs to. */
	entityType: 'PERSON' | 'UNION';
	entityId: string;
	type: string;
	date: DateValue;
	place: string | null;
	description: string | null;
	version: number;
	createdAt: Date;
	updatedAt: Date;
}