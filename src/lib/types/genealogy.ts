import type { TreeRole } from '#lib/shared/roles.js';
import type { LayoutMode } from '#lib/shared/view-mode.js';

export interface TreeSummary {
	id: string;
	name: string;
	description: string | null;
	/** The caller's role in the tree; the tree list always carries it. */
	role?: TreeRole;
	/** The caller's own choice of view in this tree; null until they make one. */
	viewMode?: LayoutMode | null;
	/** The view for members with no choice of their own; null is flat. */
	defaultViewMode?: LayoutMode | null;
}

export interface ImportPreviewData {
	mode: 'replace' | 'merge';
	deleteCounts?: {
		individuals: number;
		families: number;
		events: number;
		childLinks: number;
	};
	merge?: {
		newIndividuals: number;
		existingIndividuals: number;
		newFamilies: number;
		mergedFamilies: number;
		newChildLinks: number;
		duplicateChildLinks: number;
		newEvents: number;
		duplicateEvents: number;
	};
	incoming: {
		individuals: number;
		families: number;
		events: number;
	};
	/** Families the file repeats: exact ones can be merged on import, possible ones are for review. */
	duplicates: DuplicateFamilyReport;
}

export type { PossibleDuplicateGroup } from '#lib/shared/duplicate-families.js';
import type { DuplicateFamilyReport } from '#lib/shared/duplicate-families.js';
export type { ImpactSummary } from '#lib/shared/impact.js';
export type { UnionEventInput, UnionEventType } from '#lib/shared/union-events.js';
import type { ParentChildType } from '#lib/shared/relationship-model.js';
import type { Sex } from '#lib/shared/sex.js';
import type { ImpactSummary } from '#lib/shared/impact.js';
import type { EndedUnionStatus, UnionEventType } from '#lib/shared/union-events.js';

export interface PersonFormData {
	givenName?: string | null;
	surname?: string | null;
	sex: Sex;
	birthDate?: string | null;
	birthPlace?: string | null;
	deathDate?: string | null;
	deathPlace?: string | null;
}

export type ParentRole = 'parent' | 'mother' | 'father';

export type RelationshipIntent =
	| {
			kind: 'add_parent';
			child: PersonRef;
			parent: PersonRef;
			type: ParentChildType;
			role: ParentRole;
			unionLabel: string | null;
			unionId?: string | null;
	  }
	| {
			kind: 'add_child';
			parent: PersonRef;
			child: PersonRef;
			type: ParentChildType;
			unionLabel: string | null;
			unionId?: string | null;
	  }
	| {
			kind: 'add_sibling';
			person: PersonRef;
			sibling: PersonRef;
			parentIds: string[];
			type: ParentChildType;
	  }
	| {
			kind: 'add_partner';
			person: PersonRef;
			partner: PersonRef;
			unionLabel: string | null;
			unionId?: string | null;
	  }
	| {
			kind: 'change_link_type';
			parent: PersonRef;
			child: PersonRef;
			fromType: ParentChildType;
			toType: ParentChildType;
	  }
	| {
			kind: 'record_death';
			person: PersonRef;
			dateText: string | null;
			place: string | null;
			personVersion?: number;
	  }
	| {
			kind: 'end_union';
			person: PersonRef;
			unionId: string | null;
			status: EndedUnionStatus;
			event: { type: UnionEventType; dateText: string | null; place: string | null } | null;
			unionVersion?: number;
	  };

/** What the relationship editor can record about a person. */
export type RelationshipKind =
	'add_parent' | 'add_child' | 'add_sibling' | 'add_partner' | 'record_death' | 'end_union';

interface PersonRef {
	id: string;
	givenName: string | null;
	surname: string | null;
	/** True for someone the intent creates; the server replaces `id`. */
	isNew?: boolean;
}

interface RelationshipPlanWarning {
	code: string;
	message: string;
}

/** Which partnership an add-child, add-parent or add-partner will use, and why. */
interface UnionChoice {
	/** Null: no partnership (a single-parent record, or a new partnership for add-partner). */
	unionId: string | null;
	/** True when the server picked it because the intent did not name one. */
	isDefault: boolean;
	/** Why the server picked it; only set when there was more than one to pick from. */
	reason: string | null;
}

export interface RelationshipPlan {
	sentence: string;
	unionChoice: UnionChoice | null;
	commands: unknown[];
	warnings: RelationshipPlanWarning[];
	/** Present on previews: exactly which records the save would write. */
	impact?: ImpactSummary;
}

/** The change-log entry a mutation returns; the toast offers Undo when `isUndoable`. */
export interface ChangeSummary {
	id: string;
	kind: string;
	summary: string;
	isUndoable: boolean;
}

// The relationship graph types are shared with the server domain (pure, no I/O).
export type { RelationshipGraph, RelationshipGraphUnion } from '#lib/shared/relationship-graph.js';

export interface PeopleSearchResult {
	id: string;
	givenName: string | null;
	surname: string | null;
	/** Set when the person matched through another of their names, not the one they are shown by. */
	matchedName?: string;
}
