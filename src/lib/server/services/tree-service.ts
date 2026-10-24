import type { DbClient } from '../db';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { GenealogyRepository } from '../repositories/genealogy-repository';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
import type { TreeAction } from '../auth/authorization';
import type { LayoutMode } from '../../shared/view-mode';
import { isValidTreeSlug } from '../../shared/tree-slug';
import { requireRealUser, requireTreeAction, requireTreeScope } from './tree-access';
import { SubtreeRepository } from '../repositories/subtree-repository';
import { visibleAmong } from '../repositories/visibility';
import { NotAdmittedError, NotFoundError, ValidationError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { MutationRunner, type MutationClock } from './mutation-runner';
import type { R2Bucket } from '@cloudflare/workers-types';
import { listAllObjects } from '../media/stored-bytes';
import { isStagingKeyOf, stagingPrefix } from './gedcom-service';
import { subdomainRefusal, type TreeHostConfig } from '../http/tree-host';

/** R2's `delete` takes at most this many keys per call. */
const R2_MAX_KEYS_PER_DELETE = 1000;

/**
 * Every R2 object a tree owns: its files and its queued GEDCOM uploads. The prefixes end in `/` and
 * `-` so that one tree's objects can never be another's; the staging check also rejects keys the
 * importer would never have written.
 */
async function treeObjectKeys(bucket: R2Bucket, treeId: string): Promise<string[]> {
	const media = await listAllObjects(bucket, `media/${treeId}/`);
	const staged = await listAllObjects(bucket, stagingPrefix(treeId));
	return [
		...media.map((o) => o.key),
		...staged.map((o) => o.key).filter((k) => isStagingKeyOf(treeId, k))
	];
}

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

	/**
	 * The tree id an API address segment stands for: the id of the tree whose id or slug it is, else
	 * the segment unchanged, which the tree's own checks then refuse as they refuse any unknown id.
	 * Not an authorization step; it reveals nothing the next check does not decide.
	 */
	async resolveSegment(segment: string): Promise<string> {
		return (await this.treeRepo.resolveSegment(segment)) ?? segment;
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

	/**
	 * `subdomains` is the install's setting, null when it serves no tree on a subdomain. It is
	 * checked only when the subdomain is turned on or its slug changes, so an install that later
	 * drops the setting can still rename a tree that has the flag.
	 */
	async updateTree(
		treeId: string,
		expectedVersion: number,
		data: {
			name?: string;
			description?: string | null;
			slug?: string | null;
			isOnSubdomain?: boolean;
		},
		context: AuthenticatedContext,
		subdomains: TreeHostConfig | null = null
	) {
		await this.requireOwnerOrAction(treeId, context, 'tree:update_settings');
		if (data.name !== undefined && !data.name.trim())
			throw new ValidationError('Tree name is required');
		// Checked here as well as at the endpoint: a slug shaped like an id would read as another tree.
		if (data.slug != null && !isValidTreeSlug(data.slug))
			throw new ValidationError('Use lower-case letters, digits and single hyphens');
		if (data.isOnSubdomain === true || (data.slug !== undefined && data.slug !== null)) {
			const current = await this.treeRepo.findById(treeId);
			if (!current) throw new NotFoundError('Tree', treeId);
			const slug = data.slug !== undefined ? data.slug : current.slug;
			const isOn = data.isOnSubdomain ?? current.isOnSubdomain === true;
			const isChanged = !current.isOnSubdomain || slug !== current.slug;
			if (isOn && isChanged) {
				if (!subdomains)
					throw new ValidationError('This install does not serve trees on subdomains');
				const refusal = subdomainRefusal(slug, subdomains);
				if (refusal) throw new ValidationError(refusal);
			}
		}
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

	/**
	 * The person the caller's view starts on in this tree; null clears it. Their own setting like the
	 * view mode. The person must be one the caller may see: a hidden person is refused exactly as a
	 * missing one, so the choice cannot be used to probe for private people.
	 */
	async setHomePerson(treeId: string, personId: string | null, context: AuthenticatedContext) {
		requireRealUser(context);
		if (personId === null) {
			await requireTreeAction(this.userRepo, treeId, context, 'tree:view');
			await this.treeRepo.setMemberHomePerson(context.user.id, treeId, null);
			return { homePersonId: null, homePersonName: null };
		}
		const name = await this.visibleName(treeId, personId, context);
		if (name === null) throw new ValidationError('That person is not in this tree');
		if (!(await this.treeRepo.setMemberHomePerson(context.user.id, treeId, personId)))
			throw new ValidationError('Only a tree you are a member of can have a starting person');
		return { homePersonId: personId, homePersonName: name };
	}

	/**
	 * Who the caller says they are in this tree; null clears it. Private to the member: only their own
	 * tree list reads it. Validated like the starting person, so a hidden person is refused as a missing one.
	 */
	async setSelfPerson(treeId: string, personId: string | null, context: AuthenticatedContext) {
		requireRealUser(context);
		if (personId === null) {
			await requireTreeAction(this.userRepo, treeId, context, 'tree:view');
			await this.treeRepo.setMemberSelfPerson(context.user.id, treeId, null);
			return { selfPersonId: null, selfPersonName: null };
		}
		const name = await this.visibleName(treeId, personId, context);
		if (name === null) throw new ValidationError('That person is not in this tree');
		if (!(await this.treeRepo.setMemberSelfPerson(context.user.id, treeId, personId)))
			throw new ValidationError('Only a tree you are a member of can link you to a person');
		return { selfPersonId: personId, selfPersonName: name };
	}

	/** The caller's own person in this tree, if still visible to them; null for a public visitor. */
	async selfPerson(
		treeId: string,
		context: AuthenticatedContext
	): Promise<{ id: string; name: string } | null> {
		if (context.user.isPublicVisitor) return null;
		const mine = (await this.treeRepo.listForUser(context.user.id)).find((t) => t.id === treeId);
		if (!mine?.selfPersonId) return null;
		const name = await this.visibleName(treeId, mine.selfPersonId, context);
		return name === null ? null : { id: mine.selfPersonId, name };
	}

	/** The display names of the caller's own "this is me" people, by tree; stale or hidden ones are left out. */
	async selfPersonNames(context: AuthenticatedContext): Promise<Record<string, string>> {
		const names: Record<string, string> = {};
		for (const tree of await this.treeRepo.listForUser(context.user.id)) {
			if (!tree.selfPersonId) continue;
			const name = await this.visibleName(tree.id, tree.selfPersonId, context);
			if (name !== null) names[tree.id] = name;
		}
		return names;
	}

	/** The display names of the caller's saved starting people, by tree; stale or hidden ones are left out. */
	async homePersonNames(context: AuthenticatedContext): Promise<Record<string, string>> {
		const names: Record<string, string> = {};
		for (const tree of await this.treeRepo.listForUser(context.user.id)) {
			if (!tree.homePersonId) continue;
			const name = await this.visibleName(tree.id, tree.homePersonId, context);
			if (name !== null) names[tree.id] = name;
		}
		return names;
	}

	/** The person's display name if they exist in the tree and the caller may see them, else null. */
	private async visibleName(
		treeId: string,
		personId: string,
		context: AuthenticatedContext
	): Promise<string | null> {
		const scope = await requireTreeScope(
			this.userRepo,
			this.treeRepo,
			treeId,
			context,
			'tree:view'
		);
		if (!(await visibleAmong(this.db, treeId, [personId], scope)).has(personId)) return null;
		return new SubtreeRepository(this.db).rootDisplayName(treeId, personId);
	}

	/**
	 * The tree `/` opens for the caller; null clears it so the most recently changed tree opens. Their
	 * own setting, so any member may set it and it is not logged or undoable.
	 */
	async setDefaultTree(treeId: string | null, context: AuthenticatedContext) {
		requireRealUser(context);
		if (treeId !== null) {
			await requireTreeAction(this.userRepo, treeId, context, 'tree:view');
			// The public tree lets a non-member view it, but only a membership can carry the flag.
			if (!(await this.treeRepo.setDefaultTree(context.user.id, treeId)))
				throw new ValidationError('Only a tree you are a member of can be your default');
		} else {
			await this.treeRepo.setDefaultTree(context.user.id, null);
		}
		return { defaultTreeId: treeId };
	}

	/**
	 * The rows go first. Had the bytes gone first, a failure between the two would leave a tree that
	 * still exists with its files gone, so every file in it would fail to open. Going rows-first, a
	 * failure can only leave bytes behind: no row points at them and nobody can read them.
	 *
	 * The sweep is best effort after that point, so a failure is logged rather than thrown. The
	 * Files manager's unlinked scan skips trees that no longer exist, so such leftovers need a
	 * manual R2 cleanup; the log line carries the tree id to find them by.
	 */
	async deleteTree(treeId: string, context: AuthenticatedContext, bucket: R2Bucket) {
		await this.requireOwnerOrAction(treeId, context, 'tree:delete');
		await this.treeRepo.delete(treeId);
		try {
			const keys = await treeObjectKeys(bucket, treeId);
			for (let i = 0; i < keys.length; i += R2_MAX_KEYS_PER_DELETE) {
				await bucket.delete(keys.slice(i, i + R2_MAX_KEYS_PER_DELETE));
			}
		} catch (error) {
			console.error('Deleted tree left stored files behind; remove them by its id prefix', {
				treeId,
				error
			});
		}
	}

	/** Counts of everything deleting a tree would erase. Deleting a tree is not undoable. */
	async previewDeleteTree(treeId: string, context: AuthenticatedContext) {
		await this.requireOwnerOrAction(treeId, context, 'tree:delete');
		return new GraphWindowRepository(this.db).deletionCounts(treeId);
	}
}
