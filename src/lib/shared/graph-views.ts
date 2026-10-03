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
