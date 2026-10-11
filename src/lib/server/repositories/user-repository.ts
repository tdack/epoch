import type { DbClient } from '../db';
import { users, treeMemberships, trees } from '../db/schema';
import type { AccessIdentity, UserIdentity, TreeMembership } from '../domain/identity';
import type { TreeRole } from '../../shared/roles';
import { eq, and } from 'drizzle-orm';
import { MemberRepository } from './member-repository';

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
	): Promise<UserIdentity | null> {
		const isInstallOwner =
			ownerEmail !== null && identity.email.trim().toLowerCase() === ownerEmail;
		const members = new MemberRepository(this.db);
		const isAdmitted =
			isInstallOwner ||
			(await members.hasPendingFor(identity.email, now)) ||
			(await this.hasAnyMembershipBySub(identity.accessSub));
		if (!isAdmitted) return null;

		const user = await this.upsertUser(identity);
		await members.redeemFor(user.id, user.email, now);
		return { ...user, isInstallOwner };
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
			if (existing.email !== identity.email || existing.name !== identity.name) {
				await this.db
					.update(users)
					.set({
						email: identity.email,
						name: identity.name || existing.name,
						updatedAt: new Date()
					})
					.where(eq(users.id, existing.id));
			}
			return {
				id: existing.id,
				accessSub: existing.accessSub,
				email: identity.email,
				name: identity.name || existing.name
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
			name: identity.name || null
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
}
