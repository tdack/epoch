import type { DbClient } from '../db';
import { trees, treeMemberships } from '../db/schema';
import { eq, and, exists, like, or, sql } from 'drizzle-orm';
import { ConcurrencyConflictError, NotFoundError, ValidationError } from '../domain/errors';
import type { TreeRole } from '../../shared/roles';
import { parseLayoutMode, type LayoutMode } from '../../shared/view-mode';
import { DEFAULT_DATE_FORMAT, isDateFormat, type DateFormat } from '../../shared/date-display';
import { MAX_TREE_SLUG_LENGTH, slugifyTreeName } from '../../shared/tree-slug';

export interface TreeSummary {
	id: string;
	/** The readable address segment (ADR-045); null when the tree is reached by its id. */
	slug: string | null;
	name: string;
	description: string | null;
	version: number;
	role?: TreeRole;
	viewMode?: LayoutMode | null;
	/** Who the caller's view starts on; set on the tree list only. May be stale. */
	homePersonId?: string | null;
	/** Who the caller says they are; private to them, set on the tree list only. May be stale. */
	selfPersonId?: string | null;
	/** Whether `/` opens this tree for the caller; set on the tree list only. */
	isDefault?: boolean;
	/** Also served at its slug's subdomain; set by `findById` and `update` only. */
	isOnSubdomain?: boolean;
	/** How the tree's dates read as words (ADR-079); set by `findById` and `update` only. */
	dateFormat?: DateFormat;
	createdAt: Date | null;
	updatedAt: Date | null;
}

export interface PublicTreeRef {
	id: string;
	slug: string | null;
	name: string;
	since: Date | null;
}

/** One row of the install owner's Trees page: every tree, whether or not they belong to it. */
export interface InstallTreeRow {
	id: string;
	slug: string | null;
	name: string;
	version: number;
	role: TreeRole | null;
	ownerNames: string[];
	peopleCount: number;
	memberCount: number;
	isPublic: boolean;
	publicSince: Date | null;
	isOnSubdomain: boolean;
}

/**
 * The slug a tree named `name` would get: the name's own, else the first free `-2`, `-3`… after it.
 * Null when the name gives no slug. The unique index is the backstop for two creates racing.
 */
export async function availableTreeSlug(db: DbClient, name: string): Promise<string | null> {
	const base = slugifyTreeName(name);
	if (!base) return null;
	const taken = new Set(
		(
			await db
				.select({ slug: trees.slug })
				.from(trees)
				.where(or(eq(trees.slug, base), like(trees.slug, `${base}-%`)))
				.all()
		).map((row) => row.slug)
	);
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const suffix = `-${n}`;
		const candidate = `${base.slice(0, MAX_TREE_SLUG_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/** One past the last tree, so a new tree lands at the end of the owner's order. */
export async function nextTreePosition(db: DbClient): Promise<number> {
	const row = await db
		.select({ next: sql<number>`coalesce(max(${trees.position}), -1) + 1` })
		.from(trees)
		.get();
	return row?.next ?? 0;
}

export class TreeRepository {
	constructor(private db: DbClient) {}

	/**
	 * Points members' "This is me" and "Start at" people at `toId` where they named `fromId`, for a
	 * person merge. Memberships are not in the change log, so a merge's undo cannot move these back;
	 * the survivor still exists after an undo, so the pointers stay valid there.
	 */
	async repointPerson(treeId: string, fromId: string, toId: string): Promise<void> {
		for (const column of ['selfPersonId', 'homePersonId'] as const) {
			await this.db
				.update(treeMemberships)
				.set({ [column]: toId })
				.where(and(eq(treeMemberships.treeId, treeId), eq(treeMemberships[column], fromId)));
		}
	}

	async listForUser(userId: string): Promise<TreeSummary[]> {
		const records = await this.db
			.select({
				id: trees.id,
				slug: trees.slug,
				name: trees.name,
				description: trees.description,
				version: trees.version,
				role: treeMemberships.role,
				viewMode: treeMemberships.viewMode,
				homePersonId: treeMemberships.homePersonId,
				selfPersonId: treeMemberships.selfPersonId,
				isDefault: treeMemberships.isDefault,
				createdAt: trees.createdAt,
				updatedAt: trees.updatedAt
			})
			.from(treeMemberships)
			.innerJoin(trees, eq(treeMemberships.treeId, trees.id))
			.where(eq(treeMemberships.userId, userId))
			.orderBy(trees.position, trees.name, trees.id)
			.all();

		return records.map((r) => ({
			...r,
			role: r.role as TreeRole,
			// A column holds text, so a value that is not a mode (a hand edit) reads as unset.
			viewMode: parseLayoutMode(r.viewMode)
		}));
	}

	/** The per-tree privacy settings (ADR-015); null when the tree does not exist. */
	async privacySettings(treeId: string): Promise<{
		maxAliveYears: number;
		recentDeathYears: number;
		shouldShowPrivateStructure: boolean;
		isPublic: boolean;
		dateFormat: string;
	} | null> {
		const record = await this.db
			.select({
				maxAliveYears: trees.maxAliveYears,
				recentDeathYears: trees.recentDeathYears,
				shouldShowPrivateStructure: trees.shouldShowPrivateStructure,
				isPublic: trees.isPublic,
				dateFormat: trees.dateFormat
			})
			.from(trees)
			.where(eq(trees.id, treeId))
			.get();
		return record ?? null;
	}

	async updatePrivacySettings(
		treeId: string,
		patch: {
			maxAliveYears?: number;
			recentDeathYears?: number;
			shouldShowPrivateStructure?: boolean;
		}
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

	/** A member's own starting person; same rules as the view setting. False when the user is no member. */
	async setMemberHomePerson(
		userId: string,
		treeId: string,
		personId: string | null
	): Promise<boolean> {
		const updated = await this.db
			.update(treeMemberships)
			.set({ homePersonId: personId })
			.where(and(eq(treeMemberships.treeId, treeId), eq(treeMemberships.userId, userId)))
			.returning({ id: treeMemberships.id });
		return updated.length > 0;
	}

	/** The person a member says they are; same rules as the starting person. */
	async setMemberSelfPerson(
		userId: string,
		treeId: string,
		personId: string | null
	): Promise<boolean> {
		const updated = await this.db
			.update(treeMemberships)
			.set({ selfPersonId: personId })
			.where(and(eq(treeMemberships.treeId, treeId), eq(treeMemberships.userId, userId)))
			.returning({ id: treeMemberships.id });
		return updated.length > 0;
	}

	/**
	 * Makes `treeId` the tree `/` opens for this user, or none when null. The old flag is cleared
	 * first, in the same batch, because the partial unique index is checked row by row. Like the view
	 * setting it leaves `version` and `updatedAt` alone. False when the user is no member of the tree.
	 */
	async setDefaultTree(userId: string, treeId: string | null): Promise<boolean> {
		const isCurrentDefault = and(
			eq(treeMemberships.userId, userId),
			eq(treeMemberships.isDefault, true)
		);
		if (treeId === null) {
			await this.db.update(treeMemberships).set({ isDefault: false }).where(isCurrentDefault);
			return true;
		}
		// The clear only runs when the user belongs to the new tree, so a refused choice (the public
		// tree, read without membership) cannot leave them with no default at all.
		const isMemberOfTarget = exists(
			this.db
				.select({ id: treeMemberships.id })
				.from(treeMemberships)
				.where(and(eq(treeMemberships.treeId, treeId), eq(treeMemberships.userId, userId)))
		);
		const [, set] = await this.db.batch([
			this.db
				.update(treeMemberships)
				.set({ isDefault: false })
				.where(and(isCurrentDefault, isMemberOfTarget)),
			this.db
				.update(treeMemberships)
				.set({ isDefault: true })
				.where(and(eq(treeMemberships.treeId, treeId), eq(treeMemberships.userId, userId)))
				.returning({ id: treeMemberships.id })
		]);
		return set.length > 0;
	}

	async findById(treeId: string): Promise<TreeSummary | null> {
		const record = await this.db.select().from(trees).where(eq(trees.id, treeId)).get();
		if (!record) return null;
		return {
			id: record.id,
			slug: record.slug,
			name: record.name,
			description: record.description,
			version: record.version,
			isOnSubdomain: record.isOnSubdomain,
			// A column holds text, so a value that is not a format (a hand edit) reads as the default.
			dateFormat: isDateFormat(record.dateFormat) ? record.dateFormat : DEFAULT_DATE_FORMAT,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt
		};
	}

	/**
	 * The id of the tree an address segment names: its id or its slug. Null when neither matches,
	 * and the caller then carries on with the segment as given, so a missing tree is refused exactly
	 * as before slugs existed. An id match wins, though a slug can never be shaped like an id.
	 */
	async resolveSegment(segment: string): Promise<string | null> {
		const row = await this.db
			.select({ id: trees.id })
			.from(trees)
			.where(or(eq(trees.id, segment), eq(trees.slug, segment)))
			.orderBy(sql`${trees.id} = ${segment} desc`)
			.limit(1)
			.get();
		return row?.id ?? null;
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
			position: await nextTreePosition(this.db),
			slug: await availableTreeSlug(this.db, name),
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
		data: {
			name?: string;
			description?: string | null;
			slug?: string | null;
			isOnSubdomain?: boolean;
			dateFormat?: DateFormat;
		}
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

		const slug = data.slug !== undefined ? data.slug : current.slug;
		if (slug !== null && slug !== current.slug) {
			const owner = await this.resolveSegment(slug);
			if (owner && owner !== treeId)
				throw new ValidationError(`Another tree already uses "${slug}"`);
		}

		// Giving up the address gives up the subdomain with it: the subdomain is the slug.
		const isOnSubdomain = slug !== null && (data.isOnSubdomain ?? current.isOnSubdomain ?? false);

		const dateFormat = data.dateFormat ?? current.dateFormat ?? DEFAULT_DATE_FORMAT;
		const updated = await this.db
			.update(trees)
			.set({
				slug,
				isOnSubdomain,
				dateFormat,
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
			slug,
			isOnSubdomain,
			dateFormat,
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

	/**
	 * The tree served at the subdomain `label`: one read on the slug index. Null when no tree has that
	 * slug, and equally when one has it with the subdomain off, so the two cannot be told apart.
	 */
	async findOnSubdomain(label: string): Promise<{ id: string; slug: string } | null> {
		const row = await this.db
			.select({ id: trees.id, slug: trees.slug })
			.from(trees)
			.where(and(eq(trees.slug, label), eq(trees.isOnSubdomain, true)))
			.get();
		return row?.slug ? { id: row.id, slug: row.slug } : null;
	}

	/** The install's public tree, if any: one read on the partial unique index. */
	async findPublic(): Promise<PublicTreeRef | null> {
		const row = await this.db
			.select({ id: trees.id, slug: trees.slug, name: trees.name, since: trees.publicSince })
			.from(trees)
			.where(eq(trees.isPublic, true))
			.limit(1)
			.get();
		return row ?? null;
	}

	/** Every tree in the install in the owner's order, with the caller's own role in each. */
	async listAll(callerId: string): Promise<InstallTreeRow[]> {
		const rows = await this.db.all<{
			id: string;
			slug: string | null;
			name: string;
			version: number;
			role: TreeRole | null;
			owners: string | null;
			people: number;
			members: number;
			isPublic: number;
			publicSince: number | null;
			isOnSubdomain: number;
		}>(sql`
			select t.id as id, t.slug as slug, t.name as name, t.version as version,
				(select m.role from tree_memberships m where m.tree_id = t.id and m.user_id = ${callerId}) as role,
				(select group_concat(coalesce(nullif(trim(u.name), ''), u.email), char(10))
					from tree_memberships o join users u on u.id = o.user_id
					where o.tree_id = t.id and o.role = 'owner') as owners,
				(select count(*) from individuals i where i.tree_id = t.id) as people,
				(select count(*) from tree_memberships c where c.tree_id = t.id) as members,
				t.is_public as isPublic, t.public_since as publicSince,
				t.is_on_subdomain as isOnSubdomain
			from trees t order by t.position, t.name, t.id`);
		return rows.map((r) => ({
			id: r.id,
			slug: r.slug,
			name: r.name,
			version: r.version,
			role: r.role,
			ownerNames: r.owners ? r.owners.split('\n').sort() : [],
			peopleCount: r.people,
			memberCount: r.members,
			isPublic: r.isPublic === 1,
			publicSince: r.publicSince === null ? null : new Date(r.publicSince * 1000),
			isOnSubdomain: r.isOnSubdomain === 1
		}));
	}

	/** The ids of every tree in the install, for checking a submitted order against. */
	async allIds(): Promise<string[]> {
		return (await this.db.select({ id: trees.id }).from(trees).all()).map((r) => r.id);
	}

	/**
	 * Writes the order in one batch, so a half-applied order cannot be seen. Leaves `version` and
	 * `updatedAt` alone: the order is not tree content and is not in the change log (ADR-007).
	 */
	async setOrder(orderedIds: string[]): Promise<void> {
		if (orderedIds.length === 0) return;
		const [first, ...rest] = orderedIds.map((id, position) =>
			this.db.update(trees).set({ position }).where(eq(trees.id, id))
		);
		await this.db.batch([first, ...rest]);
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
