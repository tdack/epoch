import type { DbClient } from '../db';
import { trees, treeMemberships } from '../db/schema';
import { eq, desc, and, exists, sql } from 'drizzle-orm';
import { ConcurrencyConflictError, NotFoundError } from '../domain/errors';
import type { TreeRole } from '../../shared/roles';
import { parseLayoutMode, type LayoutMode } from '../../shared/view-mode';

export interface TreeSummary {
	id: string;
	name: string;
	description: string | null;
	version: number;
	role?: TreeRole;
	viewMode?: LayoutMode | null;
	defaultViewMode?: LayoutMode | null;
	createdAt: Date | null;
	updatedAt: Date | null;
}

export interface PublicTreeRef {
	id: string;
	name: string;
	since: Date | null;
}

/** One row of the install owner's Trees page: every tree, whether or not they belong to it. */
export interface InstallTreeRow {
	id: string;
	name: string;
	version: number;
	role: TreeRole | null;
	ownerNames: string[];
	peopleCount: number;
	memberCount: number;
	isPublic: boolean;
	publicSince: Date | null;
}

export class TreeRepository {
	constructor(private db: DbClient) {}

	async listForUser(userId: string): Promise<TreeSummary[]> {
		const records = await this.db
			.select({
				id: trees.id,
				name: trees.name,
				description: trees.description,
				version: trees.version,
				role: treeMemberships.role,
				viewMode: treeMemberships.viewMode,
				defaultViewMode: trees.defaultViewMode,
				createdAt: trees.createdAt,
				updatedAt: trees.updatedAt
			})
			.from(treeMemberships)
			.innerJoin(trees, eq(treeMemberships.treeId, trees.id))
			.where(eq(treeMemberships.userId, userId))
			.orderBy(desc(trees.updatedAt))
			.all();

		return records.map((r) => ({
			...r,
			role: r.role as TreeRole,
			// A column holds text, so a value that is not a mode (a hand edit) reads as unset.
			viewMode: parseLayoutMode(r.viewMode),
			defaultViewMode: parseLayoutMode(r.defaultViewMode)
		}));
	}

	/** The per-tree privacy settings (ADR-015); null when the tree does not exist. */
	async privacySettings(treeId: string): Promise<{
		maxAliveYears: number;
		shouldShowPrivateStructure: boolean;
		isPublic: boolean;
	} | null> {
		const record = await this.db
			.select({
				maxAliveYears: trees.maxAliveYears,
				shouldShowPrivateStructure: trees.shouldShowPrivateStructure,
				isPublic: trees.isPublic
			})
			.from(trees)
			.where(eq(trees.id, treeId))
			.get();
		return record ?? null;
	}

	async updatePrivacySettings(
		treeId: string,
		patch: { maxAliveYears?: number; shouldShowPrivateStructure?: boolean }
	): Promise<void> {
		await this.db
			.update(trees)
			.set({ ...patch, updatedAt: new Date() })
			.where(eq(trees.id, treeId));
	}

	/**
	 * A member's own view setting. It leaves `version` and `updatedAt` alone: they guard role edits
	 * and order the tree list, and a display choice is neither. False when the user is no member.
	 */
	async setMemberViewMode(
		userId: string,
		treeId: string,
		mode: LayoutMode | null
	): Promise<boolean> {
		const updated = await this.db
			.update(treeMemberships)
			.set({ viewMode: mode })
			.where(and(eq(treeMemberships.treeId, treeId), eq(treeMemberships.userId, userId)))
			.returning({ id: treeMemberships.id });
		return updated.length > 0;
	}

	/** The tree's default view; `version` stays, as it guards the name and description. */
	async setDefaultViewMode(treeId: string, mode: LayoutMode | null): Promise<void> {
		await this.db.update(trees).set({ defaultViewMode: mode }).where(eq(trees.id, treeId));
	}

	async findById(treeId: string): Promise<TreeSummary | null> {
		const record = await this.db.select().from(trees).where(eq(trees.id, treeId)).get();
		if (!record) return null;
		return {
			id: record.id,
			name: record.name,
			description: record.description,
			version: record.version,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt
		};
	}

	async create(
		name: string,
		description: string | null,
		ownerUserId: string
	): Promise<TreeSummary> {
		const treeId = crypto.randomUUID();
		const now = new Date();

		const newTree = {
			id: treeId,
			name: name.trim(),
			description: description?.trim() || null,
			version: 1,
			createdAt: now,
			updatedAt: now
		};

		await this.db.insert(trees).values(newTree);

		// Automatically assign creator as owner
		await this.db.insert(treeMemberships).values({
			id: crypto.randomUUID(),
			treeId,
			userId: ownerUserId,
			role: 'owner',
			createdAt: now,
			updatedAt: now
		});

		return {
			...newTree,
			role: 'owner'
		};
	}

	async update(
		treeId: string,
		expectedVersion: number,
		data: { name?: string; description?: string | null }
	): Promise<TreeSummary> {
		const current = await this.findById(treeId);
		if (!current) throw new NotFoundError('Tree', treeId);

		if (current.version !== expectedVersion) {
			throw new ConcurrencyConflictError(
				`Tree '${treeId}' was modified concurrently (current version: ${current.version}, expected: ${expectedVersion})`
			);
		}

		const now = new Date();
		const nextVersion = current.version + 1;

		const updated = await this.db
			.update(trees)
			.set({
				name: data.name !== undefined ? data.name.trim() : current.name,
				description: data.description !== undefined ? data.description : current.description,
				version: nextVersion,
				updatedAt: now
			})
			.where(and(eq(trees.id, treeId), eq(trees.version, expectedVersion)))
			.returning({ id: trees.id });
		// The read above can pass for two writers at once; only the statement knows which one won.
		if (updated.length === 0)
			throw new ConcurrencyConflictError(`Tree '${treeId}' was modified concurrently`);

		return {
			id: treeId,
			name: data.name !== undefined ? data.name.trim() : current.name,
			description: data.description !== undefined ? data.description : current.description,
			version: nextVersion,
			createdAt: current.createdAt,
			updatedAt: now
		};
	}

	async delete(treeId: string): Promise<void> {
		await this.db.delete(trees).where(eq(trees.id, treeId));
	}

	/** The install's public tree, if any: one read on the partial unique index. */
	async findPublic(): Promise<PublicTreeRef | null> {
		const row = await this.db
			.select({ id: trees.id, name: trees.name, since: trees.publicSince })
			.from(trees)
			.where(eq(trees.isPublic, true))
			.limit(1)
			.get();
		return row ?? null;
	}

	/** Every tree in the install, newest activity first, with the caller's own role in each. */
	async listAll(callerId: string): Promise<InstallTreeRow[]> {
		const rows = await this.db.all<{
			id: string;
			name: string;
			version: number;
			role: TreeRole | null;
			owners: string | null;
			people: number;
			members: number;
			isPublic: number;
			publicSince: number | null;
		}>(sql`
			select t.id as id, t.name as name, t.version as version,
				(select m.role from tree_memberships m where m.tree_id = t.id and m.user_id = ${callerId}) as role,
				(select group_concat(coalesce(nullif(trim(u.name), ''), u.email), char(10))
					from tree_memberships o join users u on u.id = o.user_id
					where o.tree_id = t.id and o.role = 'owner') as owners,
				(select count(*) from individuals i where i.tree_id = t.id) as people,
				(select count(*) from tree_memberships c where c.tree_id = t.id) as members,
				t.is_public as isPublic, t.public_since as publicSince
			from trees t order by t.updated_at desc, t.name`);
		return rows.map((r) => ({
			id: r.id,
			name: r.name,
			version: r.version,
			role: r.role,
			ownerNames: r.owners ? r.owners.split('\n').sort() : [],
			peopleCount: r.people,
			memberCount: r.members,
			isPublic: r.isPublic === 1,
			publicSince: r.publicSince === null ? null : new Date(r.publicSince * 1000)
		}));
	}

	/**
	 * Makes `treeId` the public tree, or none when null, in one batch. The old public tree is
	 * cleared first because the partial unique index is checked row by row. The name check sits in
	 * the UPDATE itself so a rename between the caller's read and this write cannot slip past it.
	 *
	 * @returns false when the tree is gone or its name no longer equals `confirmName`.
	 */
	async setPublic(
		treeId: string | null,
		confirmName: string,
		publishedBy: string,
		now: Date
	): Promise<boolean> {
		if (treeId === null) {
			const [cleared] = await this.db.batch([
				this.db
					.update(trees)
					.set({ isPublic: false, publicSince: null, publishedBy: null })
					.where(and(eq(trees.isPublic, true), eq(trees.name, confirmName)))
					.returning({ id: trees.id })
			]);
			return cleared.length > 0;
		}
		// The clear only runs when the new tree still has the confirmed name, so a rename racing this
		// call cannot unpublish the old tree and then fail to publish the new one.
		const hasConfirmedTarget = exists(
			this.db
				.select({ id: trees.id })
				.from(trees)
				.where(and(eq(trees.id, treeId), eq(trees.name, confirmName)))
		);
		const [, set] = await this.db.batch([
			this.db
				.update(trees)
				.set({ isPublic: false, publicSince: null, publishedBy: null })
				.where(and(eq(trees.isPublic, true), hasConfirmedTarget)),
			this.db
				.update(trees)
				.set({ isPublic: true, publicSince: now, publishedBy })
				.where(and(eq(trees.id, treeId), eq(trees.name, confirmName)))
				.returning({ id: trees.id })
		]);
		return set.length > 0;
	}
}
