import type { TreeRole } from './roles';
/**
 * What the tree view and its page header read, as the API answers it. The service that builds them
 * stays on the server; only the shapes live here.
 */

import type { SelectionStub } from '../tree-layout/types';
import type { RelationshipGraph } from './relationship-graph';
import type { ActiveSubtreeDto, SubtreeSummaryDto } from './subtrees';

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
	/** Set only by {@link WholeTreeGraphDto}, so a page can tell the two answers apart. */
	isWholeTree?: false;
	isTruncated?: undefined;
}

export interface TreeSummaryDto {
	/** `slug` is the tree's address segment (ADR-045); null when its id is used instead. */
	tree: {
		id: string;
		slug: string | null;
		name: string;
		description: string | null;
		version: number;
		/** Also served at `<slug>.<EPOCH_TREE_HOST_ZONE>`, showing only this tree. */
		isOnSubdomain: boolean;
	};
	counts: TreeCounts;
	/** Who is looking, so the page can hide what they cannot use without a second request. */
	viewer: {
		role: TreeRole;
		/** Reading the public tree with no membership in it (ADR-041). */
		isOutsider: boolean;
		/** Nobody identified: the page offers signing in and no user-only control. */
		isPublicVisitor: boolean;
		/** Offers the install-wide Trees page. */
		isInstallOwner: boolean;
		/** The tree is the install's public one. */
		isTreePublic: boolean;
	};
	/** The person the tree opens on when nobody has chosen one; null for an empty tree. */
	defaultFocusPersonId: string | null;
	/** The sub-trees the viewer may open, in `position` order (docs/proposal-subtrees.md). */
	subtrees: SubtreeSummaryDto[];
	/** The sub-tree the address named (`<tree>~<subtree>`), or null for the whole tree. */
	subtree: ActiveSubtreeDto | null;
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
