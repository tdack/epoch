/**
 * Phase 1 neutral genealogy domain model.
 *
 * These types describe the target model (union/partner/parent-child) that
 * replaces the gendered `families`/`family_children` prototype schema. They are
 * intentionally free of GEDCOM interchange concerns (spouse roles, XREFs) which
 * belong to the import/export layer.
 */

export const PARENT_CHILD_TYPES = {
	BIOLOGICAL: 'biological',
	ADOPTIVE: 'adoptive',
	FOSTER: 'foster',
	GUARDIAN: 'guardian',
	UNKNOWN: 'unknown'
} as const;
export type ParentChildType = (typeof PARENT_CHILD_TYPES)[keyof typeof PARENT_CHILD_TYPES];

type ParentChildStatus = 'active' | 'ended' | 'disputed';

export const UNION_STATUSES = {
	ACTIVE: 'active',
	SEPARATED: 'separated',
	DIVORCED: 'divorced',
	ANNULLED: 'annulled',
	ENDED: 'ended'
} as const;
export type UnionStatus = (typeof UNION_STATUSES)[keyof typeof UNION_STATUSES];

export { NAME_TYPES, type NameType } from '../../shared/name-types';

export interface Union {
	id: string;
	treeId: string;
	status: UnionStatus;
	version: number;
	createdAt: Date;
	updatedAt: Date;
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
