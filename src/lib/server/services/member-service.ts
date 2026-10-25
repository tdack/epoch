/**
 * Who is in a tree and what they may do there (ADR-016): inviting an email address, changing a
 * role, removing a member. Every method needs `tree:manage_members`, and the role rules of
 * `shared/membership-policy.ts` on top, so a manager can never make a peer or reach an owner.
 * A viewer or contributor cannot list members at all: an address is personal data.
 */

import type { DbClient } from '../db';
import { grantableRoles, canManageMemberOf } from '../../shared/membership-policy';
import {
	ConcurrencyConflictError,
	NotFoundError,
	UnauthorizedError,
	ValidationError
} from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import type { TreeRole } from '../../shared/roles';
import { requireTreeAction } from './tree-access';
import {
	MemberRepository,
	memberLabel,
	type JoinedInvitation,
	type MembershipLogEntry
} from '../repositories/member-repository';
import { UserRepository } from '../repositories/user-repository';
import { type InvitationSentDto, type MemberDto, type MembersDto } from '../../shared/members';
import { Logger } from '../logging/logger';
import type { InvitationMailer } from './invitation-mailer';

export const INVITATION_TTL_DAYS = 14;
/** How long a lapsed invitation stays on the Members page as Expired before it is dropped. */
const EXPIRED_INVITATION_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function logEntry(
	treeId: string,
	context: AuthenticatedContext,
	kind: MembershipLogEntry['kind'],
	summary: string
): MembershipLogEntry {
	return { treeId, actorId: context.user.id, kind, summary, correlationId: context.correlationId };
}

export class MemberService {
	private members: MemberRepository;
	private users: UserRepository;

	constructor(
		db: DbClient,
		private now: () => Date = () => new Date(),
		/** Absent where nothing can send (unit tests, a bare preview); invitations are then only saved. */
		private mailer?: InvitationMailer
	) {
		this.members = new MemberRepository(db);
		this.users = new UserRepository(db);
	}

	/** The caller's role if it allows managing members; otherwise the same refusal as any other action. */
	private requireManager(treeId: string, context: AuthenticatedContext): Promise<TreeRole> {
		return requireTreeAction(this.users, treeId, context, 'tree:manage_members');
	}

	async list(treeId: string, context: AuthenticatedContext): Promise<MembersDto> {
		const actor = await this.requireManager(treeId, context);
		const now = this.now();
		await this.members.deleteExpiredBefore(
			treeId,
			new Date(now.getTime() - EXPIRED_INVITATION_RETENTION_DAYS * MS_PER_DAY)
		);
		const [members, invitations] = await Promise.all([
			this.members.listMembers(treeId),
			this.members.listInvitations(treeId)
		]);
		return {
			members: members
				.map((m) => ({
					...m,
					isYou: m.userId === context.user.id,
					canManage: canManageMemberOf(actor, m.role)
				}))
				.sort((a, b) => a.email.localeCompare(b.email)),
			invitations: invitations
				.map((i) => ({
					id: i.id,
					email: i.email,
					role: i.role,
					expiresAt: i.expiresAt.toISOString(),
					isExpired: i.expiresAt <= now
				}))
				.sort((a, b) => a.email.localeCompare(b.email)),
			grantableRoles: grantableRoles(actor)
		};
	}

	/**
	 * Offer `role` to an email address; replaces an earlier offer to the same address. The email is
	 * sent after the offer is saved and a failure to send never undoes it: the manager is told and
	 * can let the person know another way (ADR-031).
	 */
	async invite(
		treeId: string,
		input: { email: string; role: TreeRole },
		context: AuthenticatedContext
	): Promise<InvitationSentDto> {
		const actor = await this.requireManager(treeId, context);
		const email = input.email.trim().toLowerCase();
		if (!EMAIL_PATTERN.test(email)) throw new ValidationError('Enter a valid email address');
		if (!grantableRoles(actor).includes(input.role))
			throw new UnauthorizedError(`Forbidden: you cannot give the role '${input.role}'`);
		if (await this.members.isMemberEmail(treeId, email))
			throw new ValidationError('That person is already a member; change their role instead');
		// Inviting again replaces the offer, so it needs the same right as withdrawing it.
		const earlier = (await this.members.listInvitations(treeId)).find((i) => i.email === email);
		if (earlier && !grantableRoles(actor).includes(earlier.role))
			throw new UnauthorizedError('Forbidden: you cannot replace this invitation');
		const now = this.now();
		const expiresAt = new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
		const saved = await this.members.upsertInvitation(
			{
				id: crypto.randomUUID(),
				treeId,
				email,
				role: input.role,
				invitedBy: context.user.id,
				expiresAt,
				now
			},
			logEntry(treeId, context, 'invite_member', `Invited someone to join as ${input.role}`)
		);
		const wasEmailSent = await this.sendInvitationEmail(treeId, saved, context);
		return {
			id: saved.id,
			email: saved.email,
			role: saved.role,
			expiresAt: saved.expiresAt.toISOString(),
			isExpired: false,
			wasEmailSent
		};
	}

	private async sendInvitationEmail(
		treeId: string,
		saved: { email: string; role: TreeRole; expiresAt: Date },
		context: AuthenticatedContext
	): Promise<boolean> {
		if (!this.mailer) return false;
		try {
			await this.mailer.sendInvitation({
				to: saved.email,
				inviterName: context.user.name?.trim() || context.user.email,
				treeId,
				treeName: (await this.members.getTreeName(treeId)) ?? 'a family tree',
				role: saved.role,
				expiresAt: saved.expiresAt
			});
			return true;
		} catch (cause) {
			// The address is left out of the log: it is personal data and the code says what went wrong.
			new Logger({ correlationId: context.correlationId, treeId }).error(
				'Invitation email was not sent',
				cause,
				{ code: (cause as { code?: unknown } | null)?.code }
			);
			return false;
		}
	}

	/**
	 * Tell each inviter that their invitation was taken up. Never throws: the join has already
	 * committed and a failed email must not undo or break it (ADR-031).
	 */
	async notifyInvitersOfJoin(
		invitee: { id: string; email: string; name?: string | null },
		joined: JoinedInvitation[],
		correlationId?: string
	): Promise<void> {
		const mailer = this.mailer;
		if (!mailer) return;
		await Promise.all(
			joined.map(async (join) => {
				try {
					if (!join.invitedBy || join.invitedBy === invitee.id) return;
					const inviter = await this.users.findById(join.invitedBy);
					if (!inviter?.email) return;
					await mailer.sendInvitationAccepted({
						to: inviter.email,
						inviteeName: invitee.name?.trim() || invitee.email,
						inviteeEmail: invitee.email,
						treeId: join.treeId,
						treeName: (await this.members.getTreeName(join.treeId)) ?? 'a family tree',
						role: join.role
					});
				} catch (cause) {
					new Logger({ correlationId, treeId: join.treeId }).error(
						'Invitation accepted email was not sent',
						cause,
						{ code: (cause as { code?: unknown } | null)?.code }
					);
				}
			})
		);
	}

	async revokeInvitation(
		treeId: string,
		invitationId: string,
		context: AuthenticatedContext
	): Promise<void> {
		const actor = await this.requireManager(treeId, context);
		const invitation = await this.members.getInvitation(treeId, invitationId);
		if (!invitation) throw new NotFoundError('Invitation', invitationId);
		// An offer of a role the caller could not give is not theirs to withdraw.
		if (!grantableRoles(actor).includes(invitation.role))
			throw new UnauthorizedError('Forbidden: you cannot withdraw this invitation');
		await this.members.deleteInvitation(
			treeId,
			invitationId,
			logEntry(
				treeId,
				context,
				'withdraw_invitation',
				`Withdrew an invitation to join as ${invitation.role}`
			)
		);
	}

	async changeRole(
		treeId: string,
		userId: string,
		input: { role: TreeRole; version: number },
		context: AuthenticatedContext
	): Promise<MemberDto> {
		const actor = await this.requireManager(treeId, context);
		const target = await this.requireTarget(treeId, userId, actor);
		if (!grantableRoles(actor).includes(input.role))
			throw new UnauthorizedError(`Forbidden: you cannot give the role '${input.role}'`);
		const didChange = await this.members.changeRole(
			treeId,
			userId,
			input.role,
			input.version,
			this.now(),
			// Choosing the role someone already has bumps the version but changes nothing worth logging.
			input.role === target.role
				? undefined
				: logEntry(
						treeId,
						context,
						'change_member_role',
						`Changed ${memberLabel(target)}'s role from ${target.role} to ${input.role}`
					)
		);
		if (!didChange) await this.explainRefusal(treeId, userId, input.version, target.role);
		const changed = (await this.members.getMember(treeId, userId))!;
		return {
			...changed,
			isYou: changed.userId === context.user.id,
			canManage: canManageMemberOf(actor, changed.role)
		};
	}

	async remove(
		treeId: string,
		userId: string,
		version: number,
		context: AuthenticatedContext
	): Promise<void> {
		const actor = await this.requireManager(treeId, context);
		const target = await this.requireTarget(treeId, userId, actor);
		const didRemove = await this.members.remove(
			treeId,
			userId,
			version,
			logEntry(treeId, context, 'remove_member', `Removed ${memberLabel(target)} from the tree`)
		);
		if (!didRemove) await this.explainRefusal(treeId, userId, version, target.role);
	}

	private async requireTarget(treeId: string, userId: string, actor: TreeRole) {
		const target = await this.members.getMember(treeId, userId);
		if (!target) throw new NotFoundError('Member', userId);
		if (!canManageMemberOf(actor, target.role))
			throw new UnauthorizedError('Forbidden: you cannot change this member');
		return target;
	}

	/** The statement refused: either the member changed since the screen loaded, or this would leave no owner. */
	private async explainRefusal(
		treeId: string,
		userId: string,
		version: number,
		role: TreeRole
	): Promise<never> {
		const current = await this.members.getMember(treeId, userId);
		if (!current) throw new NotFoundError('Member', userId);
		if (current.version !== version)
			throw new ConcurrencyConflictError(
				'This member was changed by someone else. Reload and try again.',
				{ currentVersion: current.version }
			);
		throw new ValidationError(
			role === 'owner' ? 'A tree must keep at least one owner' : 'That change was refused'
		);
	}
}
