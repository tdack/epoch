/**
 * The one tree anyone may read without signing in (ADR-041), and the install owner's controls over
 * it. The hook and the welcome page use `current` for anonymous requests; everything else here is
 * the install owner's alone.
 */

import type { InstallTree } from '#lib/shared/api-contracts.js';
import type { DbClient } from '../db';
import { NotFoundError, ValidationError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { TreeRepository, type PublicTreeRef } from '../repositories/tree-repository';
import { requireInstallOwner } from './tree-access';

export class PublicTreeService {
	private trees: TreeRepository;

	constructor(
		db: DbClient,
		private now: () => Date = () => new Date()
	) {
		this.trees = new TreeRepository(db);
	}

	/** The public tree or null. Never cached: making a tree private must end anonymous access on the next request. */
	current(): Promise<PublicTreeRef | null> {
		return this.trees.findPublic();
	}

	/** Every tree in the install, for the Trees page. */
	async listAll(context: AuthenticatedContext): Promise<InstallTree[]> {
		requireInstallOwner(context);
		return (await this.trees.listAll(context.user.id)).map((t) => ({
			...t,
			publicSince: t.publicSince?.toISOString() ?? null
		}));
	}

	/**
	 * Makes a tree public, replaces the public tree, or (null) makes it private. Typing the name is
	 * the confirmation: of the tree being published, or of the one being withdrawn.
	 */
	async setPublicTree(
		treeId: string | null,
		confirmName: string,
		context: AuthenticatedContext
	): Promise<{ publicTree: PublicTreeRef | null }> {
		requireInstallOwner(context);
		const target =
			treeId === null ? await this.trees.findPublic() : await this.trees.findById(treeId);
		if (!target) {
			if (treeId === null) throw new ValidationError('No tree is public');
			throw new NotFoundError('Tree', treeId);
		}
		if (confirmName !== target.name)
			throw new ValidationError('Type the tree name exactly as it is to confirm');
		const didChange = await this.trees.setPublic(treeId, confirmName, context.user.id, this.now());
		// The name changed between the read and the write.
		if (!didChange) throw new ValidationError('The tree was renamed; check the name and try again');
		return { publicTree: await this.trees.findPublic() };
	}
}
