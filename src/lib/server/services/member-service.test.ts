/**
 * Member administration (ADR-016): who may invite, change and remove, how an invitation becomes a
 * membership, and that a change of role or a removal is the next request's reality.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { treeInvitations, treeMemberships } from '../db/schema';
import {
	ConcurrencyConflictError,
	NotFoundError,
	UnauthorizedError,
	ValidationError
} from '../domain/errors';
import type { TreeRole } from '../domain/identity';
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
import { INVITATION_TTL_DAYS, MemberService } from './member-service';

const NOW = new Date('2026-10-01T12:00:00Z');
let t: TestDatabase;
let clockNow = NOW;
const service = () => new MemberService(t.db, () => clockNow);

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

describe('taking up an invitation', () => {
	const signIn = (email: string, sub = `sub-${email}`) =>
		new UserRepository(t.db).upsertFromAccess({ accessSub: sub, email, name: 'Newcomer' });

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
		const late = await signIn('late@example.com');
		expect(await new UserRepository(t.db).getMembership(treeId, late.id)).toBeNull();
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
	const change = async (treeId: string, by: TestActor, target: TestActor, role: TreeRole) =>
		service().changeRole(
			treeId,
			target.userId,
			{ role, version: await versionOf(treeId, target) },
			by.context
		);

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
