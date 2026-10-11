import type { DbClient } from '../db';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { GenealogyRepository } from '../repositories/genealogy-repository';
import type { TreeAction } from '../auth/authorization';
import type { LayoutMode } from '../../shared/view-mode';
import { requireRealUser, requireTreeAction } from './tree-access';
import { NotAdmittedError, NotFoundError, ValidationError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { MutationRunner, type MutationClock } from './mutation-runner';
export class TreeService {
	private treeRepo: TreeRepository;
	private userRepo: UserRepository;
	private genealogyRepo: GenealogyRepository;
	private runner: MutationRunner;

	constructor(
		private db: DbClient,
		clock?: MutationClock
	) {
		this.runner = new MutationRunner(db, clock);
		this.treeRepo = new TreeRepository(db);
		this.userRepo = new UserRepository(db);
		this.genealogyRepo = new GenealogyRepository(db);
	}

	/**
	 * The install owner may rename and delete any tree, a member of it or not (ADR-041), so the trees
	 * page can tidy an install. The check runs before the role path: for a public tree they do not
	 * belong to, that path would otherwise answer "viewer" and refuse.
	 */
	private async requireOwnerOrAction(
		treeId: string,
		context: AuthenticatedContext,
		action: TreeAction
	): Promise<void> {
		if (context.user.isInstallOwner === true) {
			if (!(await this.treeRepo.findById(treeId))) throw new NotFoundError('Tree', treeId);
			return;
		}
		await requireTreeAction(this.userRepo, treeId, context, action);
	}

	async listTrees(context: AuthenticatedContext) {
		if (context.user.isPublicVisitor) {
			// Nobody identified has no trees of their own: the public one, read as a viewer.
			const pub = await this.treeRepo.findPublic();
			const tree = pub && (await this.treeRepo.findById(pub.id));
			return tree ? [{ ...tree, role: 'viewer' as const }] : [];
		}
		return this.treeRepo.listForUser(context.user.id);
	}

	async getTree(treeId: string, context: AuthenticatedContext) {
		// Every record of the tree, private people included, so only roles that see everyone (ADR-015).
		await requireTreeAction(this.userRepo, treeId, context, 'record:edit');
		const tree = await this.treeRepo.findById(treeId);
		if (!tree) throw new NotFoundError('Tree', treeId);
		const data = await this.genealogyRepo.getTreeData(treeId);
		return {
			tree,
			...data
		};
	}

	/**
	 * Only the install owner and people already holding a membership may start a tree (ADR-034), so a
	 * broad Access policy cannot let a stranger use the install for trees of their own. The hook turns
	 * strangers away first; this holds for every other way in (a GEDCOM import, a member removed from
	 * their last tree mid-session).
	 */
	async createTree(name: string, description: string | null, context: AuthenticatedContext) {
		if (!context.user.isInstallOwner && !(await this.userRepo.hasAnyMembership(context.user.id)))
			throw new NotAdmittedError(
				'Only the owner of this Epoch, and people already in one of its trees, can start a tree'
			);
		if (!name?.trim()) throw new ValidationError('Tree name is required');
		return this.treeRepo.create(name.trim(), description?.trim() || null, context.user.id);
	}

	async updateTree(
		treeId: string,
		expectedVersion: number,
		data: { name?: string; description?: string | null },
		context: AuthenticatedContext
	) {
		await this.requireOwnerOrAction(treeId, context, 'tree:update_settings');
		if (data.name !== undefined && !data.name.trim())
			throw new ValidationError('Tree name is required');
		return this.treeRepo.update(treeId, expectedVersion, data);
	}

	/**
	 * The caller's own choice of view in this tree; null clears it so the tree's default applies. A
	 * display setting of their own, so any member may set it and it is not logged or undoable.
	 */
	async setViewMode(treeId: string, mode: LayoutMode | null, context: AuthenticatedContext) {
		requireRealUser(context);
		await requireTreeAction(this.userRepo, treeId, context, 'tree:view');
		await this.treeRepo.setMemberViewMode(context.user.id, treeId, mode);
		return { viewMode: mode };
	}

	/** The view members with no choice of their own get; the owner's to set. */
	async setDefaultViewMode(treeId: string, mode: LayoutMode | null, context: AuthenticatedContext) {
		await requireTreeAction(this.userRepo, treeId, context, 'tree:set_default_view');
		await this.treeRepo.setDefaultViewMode(treeId, mode);
		return { defaultViewMode: mode };
	}

	async deleteTree(treeId: string, context: AuthenticatedContext) {
		await this.requireOwnerOrAction(treeId, context, 'tree:delete');
		return this.treeRepo.delete(treeId);
	}

	/** Counts of everything deleting a tree would erase. Deleting a tree is not undoable. */
	async previewDeleteTree(treeId: string, context: AuthenticatedContext) {
		await this.requireOwnerOrAction(treeId, context, 'tree:delete');
		const rows = await this.runner.store.loadRows(treeId);
		return {
			people: rows.individuals.length,
			unions: rows.unions.length,
			links: rows.parentChild.length,
			events: rows.events.length,
			media: rows.mediaItems.length
		};
	}
}
