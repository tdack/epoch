/**
 * Phase 1 neutral genealogy domain model.
 *
 * These types describe the target model (union/partner/parent-child) that
 * replaces the gendered `families`/`family_children` prototype schema. They are
 * intentionally free of GEDCOM interchange concerns (spouse roles, XREFs) which
 * belong to the import/export layer.
 */

type ParentChildStatus = 'active' | 'ended' | 'disputed';

import type { ParentChildType, UnionStatus } from '../../shared/relationship-model';
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
