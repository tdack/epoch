/**
 * Read service for the bounded views: the graph around a focus person and the tree's summary.
 * Nothing here loads a whole tree, except `wholeTreeGraph`: the one bounded exception, which a
 * viewer asks for by name and which is capped (ADR-035; see `whole-tree-window.ts`).
 */

import type { DbClient } from '../db';
import { NotFoundError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { firstVisiblePersonId, visibleCounts } from '../repositories/visibility';
import { loadFocusWindow, type FocusWindowOptions } from './focus-window';
import { requireTreeScope, type ViewerScope } from './tree-access';
import {
	type FocusGraphDto,
	type TreeSummaryDto,
	type WholeTreeGraphDto
} from '../../shared/graph-views';
import { loadWholeTreeWindow } from './whole-tree-window';
import { activeSubtree, summaryOfSubtrees } from './subtree-service';
import type { SubtreeSummaryDto } from '../../shared/subtrees';

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
		const window = await loadFocusWindow(
			this.repo,
			treeId,
			focusPersonId,
			options,
			scope.isRestricted ? scope : undefined
		);
		return {
			focusPersonId,
			graph: window.graph,
			drawnPersonIds: window.selection.people.map((p) => p.id),
			drawnUnionIds: window.selection.unions.map((u) => u.id),
			stubs: window.selection.stubs
		};
	}

	/** Everyone the viewer may see, up to the cap, with no focus. */
	async wholeTreeGraph(treeId: string, context: AuthenticatedContext): Promise<WholeTreeGraphDto> {
		const scope = await this.requireView(treeId, context);
		const window = await loadWholeTreeWindow(
			this.repo,
			treeId,
			scope.isRestricted ? scope : undefined
		);
		const drawn = new Set(window.personIds);
		return {
			focusPersonId: null,
			isWholeTree: true,
			isTruncated: window.isTruncated,
			graph: window.graph,
			drawnPersonIds: window.personIds,
			drawnUnionIds: window.graph.unions
				.filter((u) => u.partnerIds.some((id) => drawn.has(id)))
				.map((u) => u.id),
			stubs: []
		};
	}

	async summary(
		treeId: string,
		context: AuthenticatedContext,
		subtree: SubtreeSummaryDto | null = null
	): Promise<TreeSummaryDto> {
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
		const subtrees = await summaryOfSubtrees(this.db, treeId, scope);
		return {
			tree: {
				id: tree.id,
				slug: tree.slug,
				name: tree.name,
				description: tree.description ?? null,
				version: tree.version,
				isOnSubdomain: tree.isOnSubdomain === true
			},
			viewer: {
				role: scope.role,
				isOutsider: scope.isOutsider,
				isPublicVisitor: context.user.isPublicVisitor === true,
				isInstallOwner: context.user.isInstallOwner === true,
				isTreePublic: scope.isPublic
			},
			counts,
			defaultFocusPersonId,
			subtrees,
			subtree: await activeSubtree(this.db, treeId, subtree)
		};
	}
}
