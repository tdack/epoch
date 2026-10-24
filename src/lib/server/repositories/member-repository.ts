import { and, eq, getTableColumns, gt, lt, sql } from 'drizzle-orm';
import type { DbClient } from '../db';
import {
	changeLog,
	researchTasks,
	treeInvitations,
	treeMemberships,
	trees,
	users
} from '../db/schema';
import type { TreeRole } from '../../shared/roles';

export interface MemberRow {
	userId: string;
	email: string;
	name: string | null;
	role: TreeRole;
	version: number;
}

/** An invitation that made its holder a member, for telling whoever sent it. */
export interface JoinedInvitation {
	treeId: string;
	role: TreeRole;
	invitedBy: string | null;
}

export interface InvitationRow {
	id: string;
	treeId: string;
	email: string;
	role: TreeRole;
	expiresAt: Date;
}

/**
 * The tree's own owners other than this row: a change that would leave none is refused in the
 * statement itself, not checked first, so two owners demoting each other at once cannot both pass.
 */
const keepsAnOwner = (treeId: string) =>
	sql`(select count(*) from tree_memberships o where o.tree_id = ${treeId} and o.role = 'owner') > 1`;

/** A membership change for the audit log (ADR-075): who did it, and what it says. Never undoable. */
export interface MembershipLogEntry {
	treeId: string;
	actorId: string;
	kind:
		| 'change_member_role'
		| 'remove_member'
		| 'invite_member'
		| 'withdraw_invitation'
		| 'join_tree'
		| 'leave_epoch';
	summary: string;
	correlationId?: string | null;
}

/**
 * The audit log is read by editors, who may not see members' addresses (a manager's view), so an
 * entry names a person and never their email.
 */
export function memberLabel(member: { name?: string | null }): string {
	return member.name?.trim() || 'a member with no name set';
}

export class MemberRepository {
	constructor(private db: DbClient) {}

	async listMembers(treeId: string): Promise<MemberRow[]> {
		const rows = await this.db
			.select({
				userId: treeMemberships.userId,
				email: users.email,
				name: users.name,
				role: treeMemberships.role,
				version: treeMemberships.version
			})
			.from(treeMemberships)
			.innerJoin(users, eq(users.id, treeMemberships.userId))
			.where(eq(treeMemberships.treeId, treeId));
		return rows as MemberRow[];
	}

	async getMember(treeId: string, userId: string): Promise<MemberRow | null> {
		const rows = await this.db
			.select({
				userId: treeMemberships.userId,
				email: users.email,
				name: users.name,
				role: treeMemberships.role,
				version: treeMemberships.version
			})
			.from(treeMemberships)
			.innerJoin(users, eq(users.id, treeMemberships.userId))
			.where(and(eq(treeMemberships.treeId, treeId), eq(treeMemberships.userId, userId)));
		return (rows[0] as MemberRow | undefined) ?? null;
	}

	/**
	 * Set a member's role if their version is still `expectedVersion` and the change leaves the tree
	 * an owner. False means one of those failed; the caller reads the row to say which.
	 */
	async changeRole(
		treeId: string,
		userId: string,
		role: TreeRole,
		expectedVersion: number,
		now: Date,
		log?: MembershipLogEntry
	): Promise<boolean> {
		const update = this.db
			.update(treeMemberships)
			.set({ role, version: sql`${treeMemberships.version} + 1`, updatedAt: now })
			.where(
				and(
					eq(treeMemberships.treeId, treeId),
					eq(treeMemberships.userId, userId),
					eq(treeMemberships.version, expectedVersion),
					sql`(${treeMemberships.role} <> 'owner' or ${role} = 'owner' or ${keepsAnOwner(treeId)})`
				)
			)
			.returning({ id: treeMemberships.id });
		if (!log) return (await update).length > 0;
		const [changed] = await this.db.batch([update, this.logIfChanged(log)]);
		return changed.length > 0;
	}

	/**
	 * Remove a member under the same two conditions as `changeRole`. Their tasks stay and become
	 * unassigned in the same batch, and only if the removal happened (ADR-029).
	 */
	async remove(
		treeId: string,
		userId: string,
		expectedVersion: number,
		log: MembershipLogEntry
	): Promise<boolean> {
		const [removed] = await this.db.batch([
			this.db
				.delete(treeMemberships)
				.where(
					and(
						eq(treeMemberships.treeId, treeId),
						eq(treeMemberships.userId, userId),
						eq(treeMemberships.version, expectedVersion),
						sql`(${treeMemberships.role} <> 'owner' or ${keepsAnOwner(treeId)})`
					)
				)
				.returning({ id: treeMemberships.id }),
			this.logIfChanged(log),
			this.db
				.update(researchTasks)
				.set({ assigneeId: null })
				.where(
					and(
						eq(researchTasks.treeId, treeId),
						eq(researchTasks.assigneeId, userId),
						sql`not exists (select 1 from tree_memberships m where m.tree_id = ${treeId} and m.user_id = ${userId})`
					)
				)
		]);
		return removed.length > 0;
	}

	async getTreeName(treeId: string): Promise<string | null> {
		const rows = await this.db
			.select({ name: trees.name })
			.from(trees)
			.where(eq(trees.id, treeId))
			.limit(1);
		return rows[0]?.name ?? null;
	}

	async isMemberEmail(treeId: string, email: string): Promise<boolean> {
		const rows = await this.db
			.select({ id: treeMemberships.id })
			.from(treeMemberships)
			.innerJoin(users, eq(users.id, treeMemberships.userId))
			.where(and(eq(treeMemberships.treeId, treeId), sql`lower(${users.email}) = ${email}`))
			.limit(1);
		return rows.length > 0;
	}

	async listInvitations(treeId: string): Promise<InvitationRow[]> {
		return (await this.db
			.select()
			.from(treeInvitations)
			.where(eq(treeInvitations.treeId, treeId))) as InvitationRow[];
	}

	/** Drop this tree's invitations that lapsed before `cutoff`; later ones still show as expired. */
	async deleteExpiredBefore(treeId: string, cutoff: Date): Promise<void> {
		await this.db
			.delete(treeInvitations)
			.where(and(eq(treeInvitations.treeId, treeId), lt(treeInvitations.expiresAt, cutoff)));
	}

	async getInvitation(treeId: string, invitationId: string): Promise<InvitationRow | null> {
		const rows = await this.db
			.select()
			.from(treeInvitations)
			.where(and(eq(treeInvitations.treeId, treeId), eq(treeInvitations.id, invitationId)));
		return (rows[0] as InvitationRow | undefined) ?? null;
	}

	/** One pending offer per tree and address: inviting again replaces the role and restarts the clock. */
	async upsertInvitation(
		invitation: InvitationRow & { invitedBy: string; now: Date },
		log: MembershipLogEntry
	): Promise<InvitationRow> {
		const upsert = this.db
			.insert(treeInvitations)
			.values({
				id: invitation.id,
				treeId: invitation.treeId,
				email: invitation.email,
				role: invitation.role,
				invitedBy: invitation.invitedBy,
				expiresAt: invitation.expiresAt,
				createdAt: invitation.now
			})
			.onConflictDoUpdate({
				target: [treeInvitations.treeId, treeInvitations.email],
				set: {
					role: invitation.role,
					invitedBy: invitation.invitedBy,
					expiresAt: invitation.expiresAt,
					createdAt: invitation.now
				}
			})
			.returning();
		const [rows] = await this.db.batch([upsert, this.logIfChanged(log)]);
		return rows[0] as InvitationRow;
	}

	async deleteInvitation(
		treeId: string,
		invitationId: string,
		log: MembershipLogEntry
	): Promise<void> {
		await this.db.batch([
			this.db
				.delete(treeInvitations)
				.where(and(eq(treeInvitations.treeId, treeId), eq(treeInvitations.id, invitationId))),
			this.logIfChanged(log)
		]);
	}

	/** Every unexpired invitation to this address, in any tree. */
	async pendingFor(email: string, now: Date) {
		return this.db
			.select()
			.from(treeInvitations)
			.where(
				and(
					eq(treeInvitations.email, email.trim().toLowerCase()),
					gt(treeInvitations.expiresAt, now)
				)
			);
	}

	/**
	 * Turn the unexpired invitations `pendingFor` returned into memberships, then delete them. Run on
	 * each authenticated request, so a person invited to a second tree gets it on their next one. A person
	 * who is already a member keeps the role they have: an invitation never lowers one. Insert first,
	 * delete after, so a failure between them leaves an invitation that redeems again harmlessly.
	 */
	async redeem(
		user: { id: string; name?: string | null },
		pending: Awaited<ReturnType<MemberRepository['pendingFor']>>,
		now: Date
	): Promise<JoinedInvitation[]> {
		const joined: JoinedInvitation[] = [];
		for (const invitation of pending) {
			const [inserted] = await this.db.batch([
				this.db
					.insert(treeMemberships)
					.values({
						id: crypto.randomUUID(),
						treeId: invitation.treeId,
						userId: user.id,
						role: invitation.role,
						createdAt: now,
						updatedAt: now
					})
					.onConflictDoNothing()
					// An empty result is the conflict: the row that did not go in is how "joined" is told.
					.returning({ id: treeMemberships.id }),
				// A person who was already a member did not join, so nothing is logged for them.
				this.logIfChanged({
					treeId: invitation.treeId,
					actorId: user.id,
					kind: 'join_tree',
					summary: `${memberLabel(user)} joined as ${invitation.role}`
				}),
				this.db.delete(treeInvitations).where(eq(treeInvitations.id, invitation.id))
			]);
			if (inserted.length > 0) {
				joined.push({
					treeId: invitation.treeId,
					role: invitation.role,
					invitedBy: invitation.invitedBy
				});
			}
		}
		return joined;
	}

	/**
	 * Appends `entry` to the change log only if the statement just before it in the batch wrote a
	 * row, so a refused or raced change leaves no entry. It must sit directly after that statement:
	 * `changes()` counts the most recent write.
	 */
	logIfChanged(entry: MembershipLogEntry) {
		const values: Partial<Record<keyof typeof changeLog.$inferInsert, unknown>> = {
			id: crypto.randomUUID(),
			treeId: entry.treeId,
			actorId: entry.actorId,
			kind: entry.kind,
			summary: entry.summary,
			changesJson: '[]',
			correlationId: entry.correlationId ?? null,
			createdAt: Date.now()
		};
		const row = sql.join(
			Object.keys(getTableColumns(changeLog)).map(
				(key) => sql`${values[key as keyof typeof values] ?? null}`
			),
			sql`, `
		);
		// `changes()` is the previous statement in the batch: log only a write that happened. Drizzle's
		// typed insert-select cannot take a raw guard, as in change-store.
		return (this.db.insert(changeLog) as unknown as { select: (query: unknown) => never }).select(
			sql`select ${row} where changes() > 0`
		);
	}
}
