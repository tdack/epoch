/**
 * Read service for the bounded views: the graph around a focus person and the tree's summary.
 * Nothing here loads a whole tree; `RelationshipService.getGraph` still does and remains only for
 * callers that ask for the aggregate on purpose (the tests' `api.graph()` helper).
 */

import type { DbClient } from '../db';
import { isActionAllowed } from '../auth/authorization';
import { NotFoundError, UnauthorizedError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import type { RelationshipGraph } from '../domain/relationship-graph';
import { GraphWindowRepository, type TreeCounts } from '../repositories/graph-window-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import type { SelectionStub } from '../../tree-layout/types';
import { loadFocusWindow, type FocusWindowOptions } from './focus-window';

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

	constructor(db: DbClient) {
		this.repo = new GraphWindowRepository(db);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
	}

	private async requireView(treeId: string, context: AuthenticatedContext): Promise<void> {
		const membership = await this.users.getMembership(treeId, context.user.id);
		if (!membership || !isActionAllowed(membership.role, 'tree:view')) {
			throw new UnauthorizedError("Forbidden: insufficient privileges for action 'tree:view'");
		}
	}

	async focusGraph(
		treeId: string,
		focusPersonId: string,
		options: FocusWindowOptions,
		context: AuthenticatedContext
	): Promise<FocusGraphDto> {
		await this.requireView(treeId, context);
		const window = await loadFocusWindow(this.repo, treeId, focusPersonId, options);
		return {
			focusPersonId,
			graph: window.graph,
			drawnPersonIds: window.selection.people.map((p) => p.id),
			drawnUnionIds: window.selection.unions.map((u) => u.id),
			stubs: window.selection.stubs
		};
	}

	async summary(treeId: string, context: AuthenticatedContext): Promise<TreeSummaryDto> {
		await this.requireView(treeId, context);
		const tree = await this.trees.findById(treeId);
		if (!tree) throw new NotFoundError('Tree', treeId);
		const [counts, defaultFocusPersonId] = await Promise.all([this.repo.counts(treeId), this.repo.firstPersonId(treeId)]);
		return {
			tree: { id: tree.id, name: tree.name, description: tree.description ?? null, version: tree.version },
			counts,
			defaultFocusPersonId
		};
	}
}
