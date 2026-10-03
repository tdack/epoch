/**
 * The relationship graph as the screens and the server both read it. The builder that produces it
 * stays in `server/domain/relationship-graph.ts`; only the shapes live here.
 */

import type { ParentChildType, UnionStatus } from './relationship-model';
import type { Sex } from './sex';
import type { PrivacyFlag } from './privacy';
import type { UnionEventType } from './union-events';

/** A partnership event as the graph carries it, for labels and for the union editor. */
export interface GraphUnionEvent {
	id: string;
	type: UnionEventType;
	dateText: string | null;
	/** Sort key of the date, so partnerships can be put in order without parsing text in the browser. */
	dateSort?: string | null;
	place: string | null;
}

export interface GraphParentChildInput {
	parentId: string;
	childId: string;
	type: ParentChildType;
	unionId: string | null;
}

/**
 * `isPrivate` is optional on the graph types: the builder always sets it, but graphs captured
 * before Phase 3 and hand-written test graphs do not carry it, and absent means not private.
 */
export interface RelationshipGraphPerson extends Partial<PrivacyFlag> {
	id: string;
	displayName: string;
	/** Neutral sex marker, `null` when not recorded. */
	sex: Sex | null;
	isDeceased: boolean;
	/** Original date text of the first birth and death events. Absent on older captured graphs. */
	birthDate?: string | null;
	deathDate?: string | null;
	/** Version to send back when editing this person. Absent on older captured graphs. */
	version?: number;
	/** Parents grouped by union context (`__direct__` for none). */
	parentsByUnion: Record<string, Array<{ parentId: string; type: ParentChildType }>>;
	/** Union IDs this person participates in as a partner. */
	unionIds: string[];
	/** Derived step-parent relationships (parent's partner who is not a parent). */
	stepParents: Array<{ stepParentId: string; unionId: string }>;
	/**
	 * Set only by the bounded graph window, on people it names but did not fully load (a neighbour
	 * of someone drawn). Their `unionIds`, `parentsByUnion` and `stepParents` are incomplete, so
	 * nothing may treat them as the whole story; a person the view draws is never partial.
	 */
	isPartial?: true;
}

export interface RelationshipGraphUnion extends Partial<PrivacyFlag> {
	id: string;
	status: UnionStatus;
	/** Marriage/partnership date text, when recorded. */
	marriageDate: string | null;
	marriagePlace: string | null;
	partnerIds: string[];
	/** Version to send back when editing this partnership. Absent on older captured graphs. */
	version?: number;
	/** Engagement, marriage, separation, divorce and the like, in the order people read them. */
	events?: GraphUnionEvent[];
	/** Epoch milliseconds the partnership was recorded; orders undated repeated partnerships. */
	createdAt?: number | null;
	/** Children asserted within this union, with per-parent type. */
	children: Array<{ childId: string; parentId: string; type: ParentChildType }>;
}

export interface RelationshipGraph {
	people: RelationshipGraphPerson[];
	unions: RelationshipGraphUnion[];
	/** Per-parent typed assertions (edges). */
	parentChild: GraphParentChildInput[];
}
