import type { DbClient } from '../db';
import {
	personMarks,
	researchTasks,
	treeInvitations,
	treeMemberships,
	trees,
	userSettings,
	users
} from '../db/schema';
import type { AccessIdentity, UserIdentity, TreeMembership } from '../domain/identity';
import type { TreeRole } from '../../shared/roles';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { MemberRepository, memberLabel, type JoinedInvitation } from './member-repository';

export class UserRepository {
	constructor(private db: DbClient) {}

	/**
	 * The user for who Access says someone is, or null when Epoch does not admit them (ADR-034).
	 * Admitted means the install owner, someone holding any membership, or someone with an unexpired
	 * invitation, which is redeemed here: a person invited to a tree takes it up the next time they are
	 * seen, not only the first (ADR-016).
	 *
	 * Admission is decided before anything is written, so a stranger Access lets through leaves no
	 * `users` row behind: their address is personal data Epoch has no use for. A known user who no
	 * longer holds a membership keeps their row (change history points at it) but is not updated.
	 *
	 * @param ownerEmail The install owner, lower-cased; null when there is none.
	 */
	async admitFromAccess(
		identity: AccessIdentity,
		ownerEmail: string | null,
		now: Date
	): Promise<(UserIdentity & { joined: JoinedInvitation[] }) | null> {
		const isInstallOwner =
			ownerEmail !== null && identity.email.trim().toLowerCase() === ownerEmail;
		const members = new MemberRepository(this.db);
		const pending = await members.pendingFor(identity.email, now);
		const isAdmitted =
			isInstallOwner ||
			pending.length > 0 ||
			(await this.hasAnyMembershipBySub(identity.accessSub));
		if (!isAdmitted) return null;

		const user = await this.upsertUser(identity);
		const joined = await members.redeem(user, pending, now);
		return {
			...user,
			joined,
			isInstallOwner,
			...(identity.pictureUrl && { pictureUrl: identity.pictureUrl })
		};
	}

	/** Whether the tree is the install's public one (ADR-041). One primary-key read. */
	async isTreePublic(treeId: string): Promise<boolean> {
		const row = await this.db
			.select({ isPublic: trees.isPublic })
			.from(trees)
			.where(eq(trees.id, treeId))
			.get();
		return row?.isPublic === true;
	}

	/** Whether this person holds a membership in any tree: what lets a member start a tree of their own. */
	async hasAnyMembership(userId: string): Promise<boolean> {
		const row = await this.db
			.select({ id: treeMemberships.id })
			.from(treeMemberships)
			.where(eq(treeMemberships.userId, userId))
			.limit(1)
			.get();
		return row !== undefined;
	}

	private async hasAnyMembershipBySub(accessSub: string): Promise<boolean> {
		const row = await this.db
			.select({ id: treeMemberships.id })
			.from(treeMemberships)
			.innerJoin(users, eq(users.id, treeMemberships.userId))
			.where(eq(users.accessSub, accessSub))
			.limit(1)
			.get();
		return row !== undefined;
	}

	private async upsertUser(identity: AccessIdentity): Promise<UserIdentity> {
		const existing = await this.db
			.select()
			.from(users)
			.where(eq(users.accessSub, identity.accessSub))
			.get();

		if (existing) {
			// The name is only a starting value from Access: the person can change it on their profile,
			// and syncing it here would undo that on the next request. Email stays Access's to say.
			const name = existing.name || identity.name || null;
			if (existing.email !== identity.email || existing.name !== name) {
				await this.db
					.update(users)
					.set({ email: identity.email, name, updatedAt: new Date() })
					.where(eq(users.id, existing.id));
			}
			return {
				id: existing.id,
				accessSub: existing.accessSub,
				email: identity.email,
				name
			};
		}

		const newUserId = crypto.randomUUID();
		const newUser = {
			id: newUserId,
			accessSub: identity.accessSub,
			email: identity.email,
			name: identity.name || null,
			createdAt: new Date(),
			updatedAt: new Date()
		};

		await this.db.insert(users).values(newUser);

		return {
			id: newUserId,
			accessSub: identity.accessSub,
			email: identity.email,
			name: identity.name || null,
			isNewUser: true
		};
	}

	async findById(userId: string): Promise<UserIdentity | null> {
		const user = await this.db.select().from(users).where(eq(users.id, userId)).get();
		if (!user) return null;
		return {
			id: user.id,
			accessSub: user.accessSub,
			email: user.email,
			name: user.name
		};
	}

	/** The columns the profile page and header read; null for an id that is no user. */
	async findProfile(userId: string): Promise<{
		email: string;
		name: string | null;
		avatarKey: string | null;
		updatedAt: Date;
	} | null> {
		const row = await this.db
			.select({
				email: users.email,
				name: users.name,
				avatarKey: users.avatarKey,
				updatedAt: users.updatedAt
			})
			.from(users)
			.where(eq(users.id, userId))
			.get();
		return row ? { ...row, updatedAt: row.updatedAt ?? new Date(0) } : null;
	}

	async updateName(userId: string, name: string, now: Date): Promise<void> {
		await this.db.update(users).set({ name, updatedAt: now }).where(eq(users.id, userId));
	}

	/** Also bumps `updated_at`, which is the avatar URL's cache-busting version. */
	async setAvatarKey(userId: string, avatarKey: string | null, now: Date): Promise<void> {
		await this.db.update(users).set({ avatarKey, updatedAt: now }).where(eq(users.id, userId));
	}

	/** Whether two people are members of at least one tree in common. */
	async sharesTree(userId: string, otherUserId: string): Promise<boolean> {
		const other = alias(treeMemberships, 'other_membership');
		const row = await this.db
			.select({ id: treeMemberships.id })
			.from(treeMemberships)
			.innerJoin(other, eq(other.treeId, treeMemberships.treeId))
			.where(and(eq(treeMemberships.userId, userId), eq(other.userId, otherUserId)))
			.limit(1)
			.get();
		return row !== undefined;
	}

	async getMembership(treeId: string, userId: string): Promise<TreeMembership | null> {
		const member = await this.db
			.select()
			.from(treeMemberships)
			.where(and(eq(treeMemberships.treeId, treeId), eq(treeMemberships.userId, userId)))
			.get();

		// Not a member means no access. This used to make the first caller the owner of any tree with
		// no members, so once a second person could sign in they would have taken every ownerless tree;
		// ownership is now assigned by `tree-repository.create` or by hand (ADR-015, Phase 4 migration).
		if (!member) return null;

		return {
			id: member.id,
			treeId: member.treeId,
			userId: member.userId,
			role: member.role as TreeRole,
			createdAt: member.createdAt || new Date(),
			updatedAt: member.updatedAt || new Date()
		};
	}

	async addMembership(treeId: string, userId: string, role: TreeRole): Promise<TreeMembership> {
		const id = crypto.randomUUID();
		const now = new Date();
		await this.db.insert(treeMemberships).values({
			id,
			treeId,
			userId,
			role,
			createdAt: now,
			updatedAt: now
		});

		return {
			id,
			treeId,
			userId,
			role,
			createdAt: now,
			updatedAt: now
		};
	}

	/** The trees where this person is an owner and no one else is. */
	async soleOwnerTrees(userId: string): Promise<{ id: string; name: string }[]> {
		const other = alias(treeMemberships, 'other_owner');
		return this.db
			.select({ id: trees.id, name: trees.name })
			.from(treeMemberships)
			.innerJoin(trees, eq(trees.id, treeMemberships.treeId))
			.where(
				and(
					eq(treeMemberships.userId, userId),
					eq(treeMemberships.role, 'owner'),
					sql`not exists (select 1 from tree_memberships ${other} where ${other.treeId} = ${treeMemberships.treeId} and ${other.role} = 'owner' and ${other.userId} <> ${userId})`
				)
			);
	}

	/** Each tree the person belongs to with its other owners: what the farewell email lists, read before the memberships go. */
	async treesWithOwners(
		userId: string
	): Promise<{ name: string; owners: { name: string | null; email: string }[] }[]> {
		const mine = await this.db
			.select({ id: trees.id, name: trees.name })
			.from(treeMemberships)
			.innerJoin(trees, eq(trees.id, treeMemberships.treeId))
			.where(eq(treeMemberships.userId, userId));
		if (mine.length === 0) return [];
		const owners = await this.db
			.select({ treeId: treeMemberships.treeId, name: users.name, email: users.email })
			.from(treeMemberships)
			.innerJoin(users, eq(users.id, treeMemberships.userId))
			.where(
				and(
					inArray(
						treeMemberships.treeId,
						mine.map((tree) => tree.id)
					),
					eq(treeMemberships.role, 'owner'),
					ne(treeMemberships.userId, userId)
				)
			);
		return mine.map((tree) => ({
			name: tree.name,
			owners: owners
				.filter((owner) => owner.treeId === tree.id)
				.map(({ name, email }) => ({ name, email }))
		}));
	}

	/**
	 * Removes everything that ties the person to Epoch except the `users` row, in one batch: the
	 * `users` row stays so the change log still names them. Memberships, settings and marks would
	 * cascade from a user delete anyway; they are listed because the row is not deleted. Pending
	 * invitations go too, or admission would take the person straight back. Tasks they were assigned
	 * become unassigned, as when a member is removed (ADR-029).
	 */
	async leave(
		user: { id: string; email: string; name?: string | null },
		now: Date,
		correlationId: string | null = null
	): Promise<void> {
		const userId = user.id;
		const members = new MemberRepository(this.db);
		const memberships = await this.db
			.select({ treeId: treeMemberships.treeId })
			.from(treeMemberships)
			.where(eq(treeMemberships.userId, userId));
		// One delete per tree, each followed by its own log entry, so every tree's log says who left.
		const departures = memberships.flatMap(({ treeId }) => [
			this.db
				.delete(treeMemberships)
				.where(and(eq(treeMemberships.treeId, treeId), eq(treeMemberships.userId, userId))),
			members.logIfChanged({
				treeId,
				actorId: userId,
				kind: 'leave_epoch',
				summary: `${memberLabel(user)} left Epoch`,
				correlationId
			})
		]);
		await this.db.batch([
			this.db.delete(userSettings).where(eq(userSettings.userId, userId)),
			...departures,
			// Catches a membership added after the read above; it is gone too, if unlogged.
			this.db.delete(treeMemberships).where(eq(treeMemberships.userId, userId)),
			this.db.delete(personMarks).where(eq(personMarks.userId, userId)),
			this.db
				.delete(treeInvitations)
				.where(eq(treeInvitations.email, user.email.trim().toLowerCase())),
			this.db
				.update(researchTasks)
				.set({ assigneeId: null })
				.where(eq(researchTasks.assigneeId, userId)),
			this.db.update(users).set({ avatarKey: null, updatedAt: now }).where(eq(users.id, userId))
		]);
	}
}
