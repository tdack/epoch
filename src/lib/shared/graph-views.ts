/**
 * What the tree view and its page header read, as the API answers it. The service that builds them
 * stays on the server; only the shapes live here.
 */

import type { SelectionStub } from '../tree-layout/types';
import type { RelationshipGraph } from './relationship-graph';

/** What `GET /graph?focus=` answers. */
export interface FocusGraphDto {
	focusPersonId: string;
	/** Everything the view can draw, plus the neighbours dialogs need; see `focus-window.ts`. */
	graph: RelationshipGraph;
	/** People the view draws from this graph; the rest of `graph.people` are named, not drawn. */
	drawnPersonIds: string[];
	drawnUnionIds: string[];
	/** The "+N" stubs, with the number of people each stands for. */
	stubs: SelectionStub[];
}

export interface TreeSummaryDto {
	tree: { id: string; name: string; description: string | null; version: number };
	counts: TreeCounts;
	/** The person the tree opens on when nobody has chosen one; null for an empty tree. */
	defaultFocusPersonId: string | null;
}

export interface TreeCounts {
	people: number;
	unions: number;
}

/**
 * What `GET /graph?scope=all` answers: everyone the viewer may see, up to a cap, anchored to no one.
 * `graph.people` holds the people it draws completely and may also name a few it did not load
 * (`isPartial`) just past the cap; a view draws only the former.
 */
export interface WholeTreeGraphDto {
	focusPersonId: null;
	isWholeTree: true;
	/** The viewer could see more people than the cap allowed, so the picture stops short. */
	isTruncated: boolean;
	graph: RelationshipGraph;
	drawnPersonIds: string[];
	drawnUnionIds: string[];
	stubs: [];
}

/** Either answer of the graph endpoint; `isWholeTree` tells them apart. */
export type TreeGraphDto = (FocusGraphDto & { isWholeTree?: false }) | WholeTreeGraphDto;
