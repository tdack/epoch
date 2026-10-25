/**
 * Member administration (ADR-016): who may invite, change and remove, how an invitation becomes a
 * membership, and that a change of role or a removal is the next request's reality.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { changeLog, treeInvitations, treeMemberships, users } from '../db/schema';
import {
	ConcurrencyConflictError,
	NotFoundError,
	UnauthorizedError,
	ValidationError
} from '../domain/errors';
import type { TreeRole } from '../../shared/roles';
import { UserRepository } from '../repositories/user-repository';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { ListService } from './list-service';
import type { InvitationEmail, InvitationMailer } from './invitation-mailer';
import { INVITATION_TTL_DAYS, MemberService } from './member-service';

const NOW = new Date('2026-10-01T12:00:00Z');
let t: TestDatabase;
let clockNow = NOW;
const service = () => new MemberService(t.db, () => clockNow);
const noAcceptedNotice = async () => {};

/** A tree with an owner, a manager and one member of each lower role. */
async function tree() {
	const actors = {} as Record<TreeRole, TestActor>;
	actors.owner = await createTestUser(t.db, 'owner');
	const treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['manager', 'editor', 'contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	return { treeId, actors };
}
const versionOf = async (treeId: string, actor: TestActor) =>
	(await t.db.select().from(treeMemberships).where(eq(treeMemberships.userId, actor.userId)))[0]!
		.version;
const roleOf = async (treeId: string, actor: TestActor) =>
	(await t.db.select().from(treeMemberships).where(eq(treeMemberships.userId, actor.userId)))[0]
		?.role;

const change = async (treeId: string, by: TestActor, target: TestActor, role: TreeRole) =>
	service().changeRole(
		treeId,
		target.userId,
		{ role, version: await versionOf(treeId, target) },
		by.context
	);

beforeAll(async () => {
	t = await createTestDatabase();
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('who may see the members', () => {
	it.each(['owner', 'manager'] as const)('lets a %s list them', async (role) => {
		const { treeId, actors } = await tree();
		const listed = await service().list(treeId, actors[role].context);
		expect(listed.members).toHaveLength(5);
	});

	it.each(['editor', 'contributor', 'viewer'] as const)(
		'refuses a %s, because an address is personal data',
		async (role) => {
			const { treeId, actors } = await tree();
			await expect(service().list(treeId, actors[role].context)).rejects.toBeInstanceOf(
				UnauthorizedError
			);
		}
	);

	it('refuses someone who is not a member, and a member of another tree', async () => {
		const { treeId } = await tree();
		const other = await tree();
		await expect(service().list(treeId, other.actors.owner.context)).rejects.toBeInstanceOf(
			UnauthorizedError
		);
		await expect(
			service().list(treeId, (await createTestUser(t.db, 'nobody')).context)
		).rejects.toBeInstanceOf(UnauthorizedError);
	});

	it('offers a manager the roles below manager and an owner every role, and marks whom they may change', async () => {
		const { treeId, actors } = await tree();
		const asManager = await service().list(treeId, actors.manager.context);
		expect(asManager.grantableRoles).toEqual(['editor', 'contributor', 'viewer']);
		expect(
			asManager.members
				.filter((m) => m.canManage)
				.map((m) => m.role)
				.sort()
		).toEqual(['contributor', 'editor', 'viewer']);
		expect((await service().list(treeId, actors.owner.context)).grantableRoles).toHaveLength(5);
	});
});

describe('inviting', () => {
	it('lets a manager invite up to editor, and not a manager or an owner', async () => {
		const { treeId, actors } = await tree();
		await expect(
			service().invite(treeId, { email: 'a@example.com', role: 'editor' }, actors.manager.context)
		).resolves.toMatchObject({ role: 'editor' });
		for (const role of ['manager', 'owner'] as const) {
			await expect(
				service().invite(treeId, { email: 'b@example.com', role }, actors.manager.context),
				role
			).rejects.toBeInstanceOf(UnauthorizedError);
		}
	});

	it("does not let a manager replace an owner's invitation to a higher role", async () => {
		const { treeId, actors } = await tree();
		await service().invite(
			treeId,
			{ email: 'm@example.com', role: 'manager' },
			actors.owner.context
		);
		await expect(
			service().invite(treeId, { email: 'm@example.com', role: 'viewer' }, actors.manager.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
		const pending = (await service().list(treeId, actors.owner.context)).invitations;
		expect(pending.find((i) => i.email === 'm@example.com')?.role).toBe('manager');
	});

	it('lets an owner invite anyone, and refuses every lower role', async () => {
		const { treeId, actors } = await tree();
		await expect(
			service().invite(treeId, { email: 'o@example.com', role: 'owner' }, actors.owner.context)
		).resolves.toBeTruthy();
		for (const role of ['editor', 'contributor', 'viewer'] as const) {
			await expect(
				service().invite(treeId, { email: 'x@example.com', role: 'viewer' }, actors[role].context),
				role
			).rejects.toBeInstanceOf(UnauthorizedError);
		}
	});

	it('lower-cases the address, replaces an earlier offer and restarts its clock', async () => {
		const { treeId, actors } = await tree();
		const first = await service().invite(
			treeId,
			{ email: '  Ada@Example.COM ', role: 'viewer' },
			actors.owner.context
		);
		clockNow = new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000);
		const again = await service().invite(
			treeId,
			{ email: 'ada@example.com', role: 'editor' },
			actors.owner.context
		);
		clockNow = NOW;
		expect(first.email).toBe('ada@example.com');
		expect((await service().list(treeId, actors.owner.context)).invitations).toHaveLength(1);
		expect(again.role).toBe('editor');
		expect(Date.parse(again.expiresAt) - Date.parse(first.expiresAt)).toBe(5 * 24 * 60 * 60 * 1000);
		expect(Date.parse(first.expiresAt) - NOW.getTime()).toBe(
			INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000
		);
	});

	it('refuses a bad address, and one that already belongs to a member', async () => {
		const { treeId, actors } = await tree();
		await expect(
			service().invite(treeId, { email: 'not an email', role: 'viewer' }, actors.owner.context)
		).rejects.toBeInstanceOf(ValidationError);
		const row = (await service().list(treeId, actors.owner.context)).members.find(
			(m) => m.role === 'viewer'
		)!;
		await expect(
			service().invite(
				treeId,
				{ email: row.email.toUpperCase(), role: 'viewer' },
				actors.owner.context
			)
		).rejects.toBeInstanceOf(ValidationError);
	});

	it("lets a manager withdraw an offer they could have made, and not an owner's", async () => {
		const { treeId, actors } = await tree();
		const small = await service().invite(
			treeId,
			{ email: 'small@example.com', role: 'viewer' },
			actors.owner.context
		);
		const big = await service().invite(
			treeId,
			{ email: 'big@example.com', role: 'manager' },
			actors.owner.context
		);
		await expect(
			service().revokeInvitation(treeId, big.id, actors.manager.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
		await service().revokeInvitation(treeId, small.id, actors.manager.context);
		await expect(
			service().revokeInvitation(treeId, small.id, actors.manager.context)
		).rejects.toBeInstanceOf(NotFoundError);
		// An invitation of another tree is as absent as a missing one.
		const other = await tree();
		await expect(
			service().revokeInvitation(other.treeId, big.id, other.actors.owner.context)
		).rejects.toBeInstanceOf(NotFoundError);
	});
});

describe('pruning old invitations', () => {
	const DAY_MS = 24 * 60 * 60 * 1000;
	const offer = (treeId: string, email: string, expiredDaysAgo: number) =>
		t.db.insert(treeInvitations).values({
			id: crypto.randomUUID(),
			treeId,
			email,
			role: 'viewer',
			expiresAt: new Date(clockNow.getTime() - expiredDaysAgo * DAY_MS)
		});

	it('drops what lapsed over 30 days ago, keeps recent expiries, and leaves other trees alone', async () => {
		const { treeId, actors } = await tree();
		const other = await tree();
		await offer(treeId, 'old@example.com', 31);
		await offer(treeId, 'recent@example.com', 5);
		await offer(other.treeId, 'old@example.com', 31);
		const { invitations } = await service().list(treeId, actors.owner.context);
		expect(invitations.map((i) => [i.email, i.isExpired])).toEqual([['recent@example.com', true]]);
		const elsewhere = await t.db
			.select()
			.from(treeInvitations)
			.where(eq(treeInvitations.treeId, other.treeId));
		expect(elsewhere).toHaveLength(1);
	});
});

describe('emailing an invitation', () => {
	const pendingFor = async (email: string) =>
		(await t.db.select().from(treeInvitations).where(eq(treeInvitations.email, email))).length;

	it('sends it after saving, to the invited address, with the offer and who made it', async () => {
		const { treeId, actors } = await tree();
		const sent: InvitationEmail[] = [];
		const mailer: InvitationMailer = {
			sendInvitationAccepted: noAcceptedNotice,
			sendInvitation: async (invitation) => {
				// Saved before it is sent, so a failure here could never take the offer with it.
				expect(await pendingFor('mail1@example.com')).toBe(1);
				sent.push(invitation);
			}
		};
		const dto = await new MemberService(t.db, () => clockNow, mailer).invite(
			treeId,
			{ email: ' Mail1@Example.com ', role: 'editor' },
			actors.manager.context
		);
		expect(dto.wasEmailSent).toBe(true);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			to: 'mail1@example.com',
			inviterName: 'manager',
			treeId,
			role: 'editor',
			expiresAt: new Date(NOW.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000)
		});
		expect(sent[0]!.treeName).toMatch(/^Test tree /);
	});

	it('sends again on a re-invite, with the replacing role', async () => {
		const { treeId, actors } = await tree();
		const roles: TreeRole[] = [];
		const mailer: InvitationMailer = {
			sendInvitationAccepted: noAcceptedNotice,
			sendInvitation: async (i) => void roles.push(i.role)
		};
		const svc = new MemberService(t.db, () => clockNow, mailer);
		await svc.invite(
			treeId,
			{ email: 'mail2@example.com', role: 'viewer' },
			actors.manager.context
		);
		await svc.invite(
			treeId,
			{ email: 'mail2@example.com', role: 'editor' },
			actors.manager.context
		);
		expect(roles).toEqual(['viewer', 'editor']);
		expect(await pendingFor('mail2@example.com')).toBe(1);
	});

	it('keeps the invitation when the email fails, and says it was not sent', async () => {
		const { treeId, actors } = await tree();
		const mailer: InvitationMailer = {
			sendInvitationAccepted: noAcceptedNotice,
			sendInvitation: async () => {
				throw Object.assign(new Error('nope'), { code: 'E_SENDER_NOT_VERIFIED' });
			}
		};
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		const dto = await new MemberService(t.db, () => clockNow, mailer).invite(
			treeId,
			{ email: 'mail3@example.com', role: 'viewer' },
			actors.manager.context
		);
		expect(dto.wasEmailSent).toBe(false);
		expect(await pendingFor('mail3@example.com')).toBe(1);
		const logged = errors.mock.calls.map((c) => String(c[0])).join('\n');
		expect(logged).toContain('E_SENDER_NOT_VERIFIED');
		expect(logged).toContain(actors.manager.context.correlationId);
		expect(logged).not.toContain('mail3@example.com');
		errors.mockRestore();
	});

	it('only saves it when there is no mailer', async () => {
		const { treeId, actors } = await tree();
		const dto = await service().invite(
			treeId,
			{ email: 'mail4@example.com', role: 'viewer' },
			actors.manager.context
		);
		expect(dto.wasEmailSent).toBe(false);
		expect(await pendingFor('mail4@example.com')).toBe(1);
	});
});

describe('taking up an invitation', () => {
	const admit = (email: string, sub = `sub-${email}`) =>
		new UserRepository(t.db).admitFromAccess(
			{ accessSub: sub, email, name: 'Newcomer' },
			null,
			// The service's clock, not the wall clock: offers made at NOW expire 14 days later.
			clockNow
		);
	const signIn = async (email: string) => {
		const user = await admit(email);
		if (!user) throw new Error(`${email} was not admitted`);
		return user;
	};

	it('gives the role on the first sign-in with that address, whatever its case, and uses the offer up', async () => {
		const { treeId, actors } = await tree();
		await service().invite(
			treeId,
			{ email: 'Newbie@Example.com', role: 'contributor' },
			actors.owner.context
		);
		const user = await signIn('NEWBIE@example.com');
		expect((await new UserRepository(t.db).getMembership(treeId, user.id))?.role).toBe(
			'contributor'
		);
		expect((await service().list(treeId, actors.owner.context)).invitations).toEqual([]);
	});

	it('gives a second tree on a later sign-in, and never lowers a role they already hold', async () => {
		const a = await tree();
		const b = await tree();
		await service().invite(
			a.treeId,
			{ email: 'twice@example.com', role: 'viewer' },
			a.actors.owner.context
		);
		const user = await signIn('twice@example.com');
		await service().invite(
			b.treeId,
			{ email: 'twice@example.com', role: 'editor' },
			b.actors.owner.context
		);
		await signIn('twice@example.com');
		const users = new UserRepository(t.db);
		expect((await users.getMembership(a.treeId, user.id))?.role).toBe('viewer');
		expect((await users.getMembership(b.treeId, user.id))?.role).toBe('editor');
		// An offer of a lower role to someone who already has a higher one leaves the higher one.
		await service()
			.invite(a.treeId, { email: 'twice@example.com', role: 'viewer' }, a.actors.owner.context)
			.catch(() => undefined);
		await t.db.insert(treeInvitations).values({
			id: crypto.randomUUID(),
			treeId: b.treeId,
			email: 'twice@example.com',
			role: 'viewer',
			expiresAt: new Date(Date.now() + 1e9)
		});
		await signIn('twice@example.com');
		expect((await users.getMembership(b.treeId, user.id))?.role).toBe('editor');
	});

	it('does not take up an expired offer, nor give anything to another address', async () => {
		const { treeId, actors } = await tree();
		clockNow = new Date(NOW.getTime() - (INVITATION_TTL_DAYS + 1) * 24 * 60 * 60 * 1000);
		await service().invite(
			treeId,
			{ email: 'late@example.com', role: 'viewer' },
			actors.owner.context
		);
		clockNow = NOW;
		await service().invite(
			treeId,
			{ email: 'someone@example.com', role: 'viewer' },
			actors.owner.context
		);
		// Nothing else admits them, so they are turned away without a user (ADR-034).
		expect(await admit('late@example.com')).toBeNull();
		const listed = await service().list(treeId, actors.owner.context);
		expect(listed.invitations.map((i) => [i.email, i.isExpired])).toEqual([
			['late@example.com', true],
			['someone@example.com', false]
		]);
	});

	it('is found by an index, not by a scan', async () => {
		const plan = await t.d1
			.prepare(
				'explain query plan select * from tree_invitations where email = ?1 and expires_at > ?2'
			)
			.bind('x@example.com', 1)
			.all<{ detail: string }>();
		expect(plan.results.map((r) => r.detail).join(' ')).toContain('idx_invitation_email');
		expect(plan.results.map((r) => r.detail).join(' ')).not.toMatch(/SCAN tree_invitations/);
	});
});

describe('changing a role', () => {
	it('lets a manager move editors, contributors and viewers between the roles below manager', async () => {
		const { treeId, actors } = await tree();
		await expect(change(treeId, actors.manager, actors.viewer, 'editor')).resolves.toMatchObject({
			role: 'editor'
		});
		await expect(
			change(treeId, actors.manager, actors.editor, 'contributor')
		).resolves.toMatchObject({ role: 'contributor' });
	});

	it('refuses a manager who would make a manager, or touch a manager, an owner or themselves', async () => {
		const { treeId, actors } = await tree();
		await expect(change(treeId, actors.manager, actors.viewer, 'manager')).rejects.toBeInstanceOf(
			UnauthorizedError
		);
		await expect(change(treeId, actors.manager, actors.viewer, 'owner')).rejects.toBeInstanceOf(
			UnauthorizedError
		);
		await expect(change(treeId, actors.manager, actors.owner, 'viewer')).rejects.toBeInstanceOf(
			UnauthorizedError
		);
		await expect(change(treeId, actors.manager, actors.manager, 'viewer')).rejects.toBeInstanceOf(
			UnauthorizedError
		);
		expect(await roleOf(treeId, actors.owner)).toBe('owner');
		expect(await roleOf(treeId, actors.manager)).toBe('manager');
	});

	it('refuses everyone below manager', async () => {
		const { treeId, actors } = await tree();
		for (const role of ['editor', 'contributor', 'viewer'] as const) {
			await expect(
				change(treeId, actors[role], actors.viewer, 'editor'),
				role
			).rejects.toBeInstanceOf(UnauthorizedError);
		}
	});

	it('lets an owner make an owner, and a tree with two owners lets one step down', async () => {
		const { treeId, actors } = await tree();
		await change(treeId, actors.owner, actors.manager, 'owner');
		await expect(change(treeId, actors.owner, actors.owner, 'manager')).resolves.toMatchObject({
			role: 'manager'
		});
		expect(await roleOf(treeId, actors.manager)).toBe('owner');
	});

	it('never leaves a tree without an owner, even when the only owner asks to', async () => {
		const { treeId, actors } = await tree();
		await expect(change(treeId, actors.owner, actors.owner, 'manager')).rejects.toBeInstanceOf(
			ValidationError
		);
		await expect(
			service().remove(
				treeId,
				actors.owner.userId,
				await versionOf(treeId, actors.owner),
				actors.owner.context
			)
		).rejects.toBeInstanceOf(ValidationError);
		expect(await roleOf(treeId, actors.owner)).toBe('owner');
	});

	it('does not let two owners demote each other at once', async () => {
		const { treeId, actors } = await tree();
		await change(treeId, actors.owner, actors.manager, 'owner');
		const [a, b] = await Promise.allSettled([
			change(treeId, actors.owner, actors.manager, 'viewer'),
			change(treeId, actors.manager, actors.owner, 'viewer')
		]);
		expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
		const owners = (
			await t.db.select().from(treeMemberships).where(eq(treeMemberships.treeId, treeId))
		).filter((m) => m.role === 'owner');
		expect(owners).toHaveLength(1);
	});

	it('answers a stale version as a conflict, and says what the current one is', async () => {
		const { treeId, actors } = await tree();
		const stale = await versionOf(treeId, actors.viewer);
		await change(treeId, actors.owner, actors.viewer, 'contributor');
		const refused = await service()
			.changeRole(
				treeId,
				actors.viewer.userId,
				{ role: 'editor', version: stale },
				actors.manager.context
			)
			.catch((e) => e);
		expect(refused).toBeInstanceOf(ConcurrencyConflictError);
		expect(refused.details).toEqual({ currentVersion: stale + 1 });
	});

	it('answers a person who is not in the tree as not found', async () => {
		const { treeId, actors } = await tree();
		const other = await tree();
		await expect(
			service().changeRole(
				treeId,
				other.actors.viewer.userId,
				{ role: 'editor', version: 1 },
				actors.owner.context
			)
		).rejects.toBeInstanceOf(NotFoundError);
	});
});

describe('removing', () => {
	it('takes effect on the very next request', async () => {
		const { treeId, actors } = await tree();
		const lists = () =>
			new ListService(t.db, () => NOW).individuals(
				treeId,
				{ limit: 5 },
				actors.contributor.context
			);
		await expect(lists()).resolves.toBeTruthy();
		await service().remove(
			treeId,
			actors.contributor.userId,
			await versionOf(treeId, actors.contributor),
			actors.manager.context
		);
		await expect(lists()).rejects.toBeInstanceOf(UnauthorizedError);
	});

	it('is refused for a manager removing a peer, an owner or themselves, and for a stale version', async () => {
		const { treeId, actors } = await tree();
		for (const target of [actors.owner, actors.manager]) {
			await expect(
				service().remove(
					treeId,
					target.userId,
					await versionOf(treeId, target),
					actors.manager.context
				)
			).rejects.toBeInstanceOf(UnauthorizedError);
		}
		await expect(
			service().remove(treeId, actors.viewer.userId, 99, actors.manager.context)
		).rejects.toBeInstanceOf(ConcurrencyConflictError);
		expect(await roleOf(treeId, actors.viewer)).toBe('viewer');
	});
});

describe('the audit log', () => {
	const logOf = async (treeId: string) =>
		t.db
			.select({
				kind: changeLog.kind,
				summary: changeLog.summary,
				actorId: changeLog.actorId,
				inverseJson: changeLog.inverseJson
			})
			.from(changeLog)
			.where(eq(changeLog.treeId, treeId))
			.orderBy(changeLog.seq);

	it('records a role change, a removal, an invitation and its withdrawal, none of them undoable', async () => {
		const { treeId, actors } = await tree();
		const members = service();
		await members.changeRole(
			treeId,
			actors.viewer.userId,
			{ role: 'editor', version: await versionOf(treeId, actors.viewer) },
			actors.manager.context
		);
		await members.remove(
			treeId,
			actors.contributor.userId,
			await versionOf(treeId, actors.contributor),
			actors.manager.context
		);
		const invited = await members.invite(
			treeId,
			{ email: 'new@example.com', role: 'viewer' },
			actors.manager.context
		);
		await members.revokeInvitation(treeId, invited.id, actors.manager.context);
		expect(await logOf(treeId)).toEqual([
			{
				kind: 'change_member_role',
				summary: "Changed viewer's role from viewer to editor",
				actorId: actors.manager.userId,
				inverseJson: null
			},
			{
				kind: 'remove_member',
				summary: 'Removed contributor from the tree',
				actorId: actors.manager.userId,
				inverseJson: null
			},
			{
				kind: 'invite_member',
				summary: 'Invited someone to join as viewer',
				actorId: actors.manager.userId,
				inverseJson: null
			},
			{
				kind: 'withdraw_invitation',
				summary: 'Withdrew an invitation to join as viewer',
				actorId: actors.manager.userId,
				inverseJson: null
			}
		]);
	});

	it('records nothing for a refused change, or for choosing the role someone already has', async () => {
		const { treeId, actors } = await tree();
		const stale = await versionOf(treeId, actors.viewer);
		await service().changeRole(
			treeId,
			actors.viewer.userId,
			{ role: 'viewer', version: stale },
			actors.owner.context
		);
		await service()
			.changeRole(
				treeId,
				actors.viewer.userId,
				{ role: 'editor', version: stale },
				actors.owner.context
			)
			.catch(() => null);
		await service()
			.remove(
				treeId,
				actors.owner.userId,
				await versionOf(treeId, actors.owner),
				actors.owner.context
			)
			.catch(() => null);
		expect(await logOf(treeId)).toEqual([]);
	});

	it('never names an email address, since editors read the log', async () => {
		const { treeId, actors } = await tree();
		// A member with no name is the case most tempted to fall back to their email.
		await t.db.update(users).set({ name: null }).where(eq(users.id, actors.viewer.userId));
		await change(treeId, actors.owner, actors.viewer, 'contributor');
		await service().invite(
			treeId,
			{ email: 'private@example.com', role: 'viewer' },
			actors.owner.context
		);
		expect((await logOf(treeId)).map((e) => e.summary).join(' ')).not.toContain('@');
	});

	it('records a newcomer joining, and nothing for someone who was already a member', async () => {
		const { treeId, actors } = await tree();
		await service().invite(
			treeId,
			{ email: 'joiner@example.com', role: 'viewer' },
			actors.owner.context
		);
		const repository = new UserRepository(t.db);
		await repository.admitFromAccess(
			{ accessSub: 'sub-joiner', email: 'joiner@example.com', name: 'Newcomer' },
			null,
			clockNow
		);
		// An offer left over for someone who already belongs redeems to nothing.
		await t.db.insert(treeInvitations).values({
			id: crypto.randomUUID(),
			treeId,
			email: 'joiner@example.com',
			role: 'editor',
			expiresAt: new Date(clockNow.getTime() + 86_400_000)
		});
		await repository.admitFromAccess(
			{ accessSub: 'sub-joiner', email: 'joiner@example.com', name: 'Newcomer' },
			null,
			clockNow
		);
		const joins = (await logOf(treeId)).filter((e) => e.kind === 'join_tree');
		expect(joins.map((e) => e.summary)).toEqual(['Newcomer joined as viewer']);
	});
});
