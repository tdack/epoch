/**
 * Public contract of the focus-centred tree layout. Everything here is plain data so the same
 * module runs in the browser, the Worker and Vitest.
 *
 * Coordinates are card/node centres in a y-down space with the focus person at the origin.
 */

import type {
	RelationshipGraph,
	RelationshipGraphPerson,
	RelationshipGraphUnion
} from '#lib/server/domain/relationship-graph.js';
import type { ParentChildType } from '#lib/server/domain/genealogy-model.js';

export type { RelationshipGraph, RelationshipGraphPerson, RelationshipGraphUnion, ParentChildType };

export interface FocusViewOptions {
	/** Generations of ancestors shown above the focus person. Default 3. */
	ancestorDepth?: number;
	/** Generations of descendants shown below the focus person. Default 3. */
	descendantDepth?: number;
	/** Show the focus person's siblings (other children of their parent unions). Default true. */
	shouldIncludeSiblings?: boolean;
}

export interface ResolvedFocusOptions {
	ancestorDepth: number;
	descendantDepth: number;
	shouldIncludeSiblings: boolean;
}

export const DEFAULT_FOCUS_OPTIONS: ResolvedFocusOptions = {
	ancestorDepth: 3,
	descendantDepth: 3,
	shouldIncludeSiblings: true
};

// ---- Selection (which people and unions are drawn) ----

export const PERSON_ROLES = {
	FOCUS: 'focus',
	ANCESTOR: 'ancestor',
	SIBLING: 'sibling',
	PARTNER: 'partner',
	DESCENDANT: 'descendant'
} as const;
export type PersonRole = (typeof PERSON_ROLES)[keyof typeof PERSON_ROLES];

export interface SelectedPerson {
	id: string;
	/** Rows relative to the focus: negative above, positive below. */
	generation: number;
	role: PersonRole;
}

export interface SelectedUnion {
	id: string;
	/** Row of the union's partners. */
	generation: number;
}

export const STUB_KINDS = {
	/** Parents that a depth limit hides above a drawn person. */
	ANCESTORS: 'ancestors',
	/** Children hidden by the depth limit, or belonging to a partner's undrawn unions. */
	CHILDREN: 'children'
} as const;
export type StubKind = (typeof STUB_KINDS)[keyof typeof STUB_KINDS];

export interface SelectionStub {
	id: string;
	kind: StubKind;
	/** Person the stub hangs from (`ancestors`), or the parent for direct/undrawn-union children. */
	personId: string;
	/** Drawn union whose children are hidden; null when the stub hangs from a person. */
	unionId: string | null;
	/** Number of hidden people it stands for. */
	count: number;
	generation: number;
}

export interface FocusSelection {
	focusPersonId: string;
	options: ResolvedFocusOptions;
	people: SelectedPerson[];
	unions: SelectedUnion[];
	stubs: SelectionStub[];
	/** People reached by more than one path (pedigree collapse or a child in two drawn unions). */
	collapsedPersonIds: string[];
}

// ---- Placement ----

export interface Point {
	x: number;
	y: number;
}

export interface PlacedPerson extends Point {
	id: string;
	generation: number;
	role: PersonRole;
	person: RelationshipGraphPerson;
}

export interface PlacedUnion extends Point {
	id: string;
	generation: number;
	/**
	 * False when the node sits on the partners' row between two adjacent cards; true when it
	 * hangs just below the row (single partner, 3+ partners, or partners that cannot be adjacent).
	 */
	isHanging: boolean;
	union: RelationshipGraphUnion;
}

export interface PlacedStub extends Point {
	id: string;
	kind: StubKind;
	personId: string;
	unionId: string | null;
	count: number;
	generation: number;
}

// ---- Edges ----

export interface EdgeBase {
	id: string;
	/** Node centres; the canvas decides how to route between them. */
	source: Point;
	target: Point;
}

/** A partner card to its union node. */
export interface PartnerEdge extends EdgeBase {
	kind: 'partner';
	unionId: string;
	personId: string;
}

export interface ChildAssertion {
	parentId: string;
	type: ParentChildType;
}

/** One edge per (union, child), or per (parent, child) for links with no union. */
export interface ChildEdge extends EdgeBase {
	kind: 'child';
	unionId: string | null;
	childId: string;
	assertions: ChildAssertion[];
	/** Distinct types across the assertions, sorted. */
	types: ParentChildType[];
	/**
	 * True when the child was placed under a different union (a child of two drawn unions, or a
	 * second path to a shared ancestor), so this edge is a dashed extra link rather than the tree edge.
	 */
	isSecondaryPath: boolean;
}

/** A "+N" stub to the person or union it stands in for. */
export interface StubEdge extends EdgeBase {
	kind: 'stub';
	stubId: string;
}

export type LayoutEdge = PartnerEdge | ChildEdge | StubEdge;

export interface TreeLayout {
	focusPersonId: string | null;
	people: PlacedPerson[];
	unions: PlacedUnion[];
	stubs: PlacedStub[];
	edges: LayoutEdge[];
	collapsedPersonIds: string[];
	/** Drawn unions whose partners could not all sit adjacent on one row. */
	nonAdjacentUnionIds: string[];
	/** Selected people the placement never reached and had to append to their row; always empty when the engine is correct. */
	misplacedPersonIds: string[];
	bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface LayoutMetrics {
	cardWidth: number;
	cardHeight: number;
	rowHeight: number;
	/** Horizontal space between two partner cards; holds the union node. */
	partnerGap: number;
	/** Horizontal space between neighbouring sibling blocks. */
	siblingGap: number;
	unionRadius: number;
	stubWidth: number;
	stubHeight: number;
}

export const LAYOUT_METRICS: LayoutMetrics = {
	cardWidth: 210,
	cardHeight: 74,
	rowHeight: 170,
	partnerGap: 56,
	siblingGap: 36,
	unionRadius: 13,
	stubWidth: 64,
	stubHeight: 30
};

export const EMPTY_LAYOUT: TreeLayout = {
	focusPersonId: null,
	people: [],
	unions: [],
	stubs: [],
	edges: [],
	collapsedPersonIds: [],
	nonAdjacentUnionIds: [],
	misplacedPersonIds: [],
	bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }
};
