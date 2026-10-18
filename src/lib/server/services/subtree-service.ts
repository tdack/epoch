/**
 * Sub-trees of a tree (docs/proposal-subtrees.md): a manager names a person as the root of a lens.
 * Reads need `tree:view` and show only the sub-trees whose root the viewer may see; writes need
 * `tree:manage_subtrees` and go through the mutation runner, so each is logged and a delete can be
 * undone.
 */

import type { DbClient } from '../db';
import { isActionAllowed } from '../auth/authorization';
import { describeCommand } from '../domain/command-summary';
import { NotFoundError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import type { SubtreeCommand } from '../domain/subtree-ops';
import { SubtreeRepository, type SubtreeRead } from '../repositories/subtree-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import type {
	ActiveSubtreeDto,
	CreateSubtreeInput,
	SubtreeDto,
	SubtreeSummaryDto,
	UpdateSubtreeInput
} from '../../shared/subtrees';
import { MutationRunner, type MutationClock, type MutationResult } from './mutation-runner';
import { requireTreeScope, type ViewerScope } from './tree-access';

const toSubtreeDto = ({ row, isRootMissing }: SubtreeRead): SubtreeDto => ({
	id: row.id,
	slug: row.slug,
	name: row.name,
	rootPersonId: row.rootPersonId,
	position: row.position,
	version: row.version,
	isRootMissing
});

/** The summary lists only sub-trees that can be opened, so a root that is missing is left out. */
export async function summaryOfSubtrees(
	db: DbClient,
	treeId: string,
	scope: ViewerScope
): Promise<SubtreeSummaryDto[]> {
	const reads = await new SubtreeRepository(db).list(treeId, scope, false);
	return reads.map(({ row }) => ({
		id: row.id,
		slug: row.slug,
		name: row.name,
		rootPersonId: row.rootPersonId
	}));
}

/** The sub-tree the address named, with its root's name for the banner. */
export async function activeSubtree(
	db: DbClient,
	treeId: string,
	subtree: SubtreeSummaryDto | null
): Promise<ActiveSubtreeDto | null> {
	if (!subtree) return null;
	const rootName = await new SubtreeRepository(db).rootDisplayName(treeId, subtree.rootPersonId);
	return { ...subtree, rootName };
}

export class SubtreeService {
	readonly runner: MutationRunner;
	private subtrees: SubtreeRepository;
	private users: UserRepository;
	private trees: TreeRepository;

	constructor(
		db: DbClient,
		clock?: MutationClock,
		private now: () => Date = () => new Date()
	) {
		this.runner = new MutationRunner(db, clock);
		this.subtrees = new SubtreeRepository(db);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
	}

	private viewerScope(treeId: string, context: AuthenticatedContext) {
		return requireTreeScope(this.users, this.trees, treeId, context, 'tree:view', this.now());
	}

	/** The viewer's sub-trees in `position` order. */
	async list(treeId: string, context: AuthenticatedContext): Promise<SubtreeDto[]> {
		const scope = await this.viewerScope(treeId, context);
		const reads = await this.subtrees.list(treeId, scope, this.canManage(scope));
		return reads.map(toSubtreeDto);
	}

	/** By id or slug. Unknown, and one whose root the viewer may not see, are both not found. */
	async get(treeId: string, idOrSlug: string, context: AuthenticatedContext): Promise<SubtreeDto> {
		const scope = await this.viewerScope(treeId, context);
		const found = await this.subtrees.find(treeId, idOrSlug, scope, this.canManage(scope));
		if (!found) throw new NotFoundError('Sub-tree', idOrSlug);
		return toSubtreeDto(found);
	}

	async create(
		treeId: string,
		input: CreateSubtreeInput,
		context: AuthenticatedContext
	): Promise<{ subtreeId: string } & MutationResult> {
		const subtreeId = this.runner.clock.newId();
		const result = await this.run(treeId, { kind: 'create_subtree', subtreeId, ...input }, context);
		return { subtreeId, ...result };
	}

	update(
		treeId: string,
		subtreeId: string,
		{ version, ...subtree }: UpdateSubtreeInput,
		context: AuthenticatedContext
	): Promise<MutationResult> {
		return this.run(
			treeId,
			{ kind: 'update_subtree', subtreeId, subtree, expectedVersion: version },
			context
		);
	}

	delete(
		treeId: string,
		subtreeId: string,
		expectedVersion: number | undefined,
		context: AuthenticatedContext
	): Promise<MutationResult> {
		return this.run(treeId, { kind: 'delete_subtree', subtreeId, expectedVersion }, context);
	}

	private canManage(scope: ViewerScope): boolean {
		return isActionAllowed(scope.role, 'tree:manage_subtrees');
	}

	private async run(
		treeId: string,
		command: SubtreeCommand,
		context: AuthenticatedContext
	): Promise<MutationResult> {
		// Before anything is planned, so a role that cannot manage is refused without learning
		// whether the sub-tree or its slug exists.
		await this.runner.requireAccess(treeId, context, 'tree:manage_subtrees');
		return this.runner.run(treeId, context, {
			kind: command.kind,
			summary: (rows) => describeCommand(command, rows),
			commands: [command],
			requiredAction: () => 'tree:manage_subtrees'
		});
	}
}
