/**
 * Read service for the bounded views: the graph around a focus person and the tree's summary.
 * Nothing here loads a whole tree; `RelationshipService.getGraph` still does and remains only for
 * callers that ask for the aggregate on purpose (the tests' `api.graph()` helper).
 */

import type { DbClient } from '../db';
import { NotFoundError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import type { RelationshipGraph } from '../domain/relationship-graph';
import { GraphWindowRepository, type TreeCounts } from '../repositories/graph-window-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { firstVisiblePersonId, visibleCounts } from '../repositories/visibility';
import type { SelectionStub } from '../../tree-layout/types';
import { loadFocusWindow, type FocusWindowOptions } from './focus-window';
import { requireTreeScope, type ViewerScope } from './tree-access';

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

export class GraphQueryService {
	private repo: GraphWindowRepository;
	private users: UserRepository;
	private trees: TreeRepository;

	constructor(
		private db: DbClient,
		private now: () => Date = () => new Date()
	) {
		this.repo = new GraphWindowRepository(db);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
	}

	private requireView(treeId: string, context: AuthenticatedContext): Promise<ViewerScope> {
		return requireTreeScope(this.users, this.trees, treeId, context, 'tree:view', this.now());
	}

	async focusGraph(
		treeId: string,
		focusPersonId: string,
		options: FocusWindowOptions,
		context: AuthenticatedContext
	): Promise<FocusGraphDto> {
		const scope = await this.requireView(treeId, context);
		const window = await loadFocusWindow(this.repo, treeId, focusPersonId, options, scope.isRestricted ? scope : undefined);
		return {
			focusPersonId,
			graph: window.graph,
			drawnPersonIds: window.selection.people.map((p) => p.id),
			drawnUnionIds: window.selection.unions.map((u) => u.id),
			stubs: window.selection.stubs
		};
	}

	async summary(treeId: string, context: AuthenticatedContext): Promise<TreeSummaryDto> {
		const scope = await this.requireView(treeId, context);
		const tree = await this.trees.findById(treeId);
		if (!tree) throw new NotFoundError('Tree', treeId);
		// Header counts and the default focus are read through the viewer's own scope: a total that
		// includes private people, or a default focus on one, would give them away.
		const [counts, defaultFocusPersonId] = await Promise.all(
			scope.isRestricted
				? [visibleCounts(this.db, treeId, scope), firstVisiblePersonId(this.db, treeId, scope)]
				: [this.repo.counts(treeId), this.repo.firstPersonId(treeId)]
		);
		return {
			tree: { id: tree.id, name: tree.name, description: tree.description ?? null, version: tree.version },
			counts,
			defaultFocusPersonId
		};
	}
}
