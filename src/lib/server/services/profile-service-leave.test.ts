import type { R2Bucket } from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	personMarks,
	researchTasks,
	treeInvitations,
	treeMemberships,
	userSettings,
	users
} from '../db/schema';
import { PUBLIC_VISITOR, type AuthenticatedContext } from '../domain/identity';
import { UserRepository } from '../repositories/user-repository';
import { FakeMediaBucket } from '../testing/fake-bucket';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { ProfileService } from './profile-service';

let t: TestDatabase;
let service: ProfileService;
let fake: FakeMediaBucket;
let bucket: R2Bucket;

beforeAll(async () => {
	t = await createTestDatabase();
	service = new ProfileService(t.db);
}, 60_000);
afterAll(async () => {
	await t.dispose();
});
beforeEach(() => {
	fake = new FakeMediaBucket();
	bucket = fake as unknown as R2Bucket;
});

/** The context's email is what Access says; the row's is what the farewell lists, so both are set equal. */
async function leaver(label: string): Promise<TestActor> {
	const actor = await createTestUser(t.db, label);
	await t.db
		.update(users)
		.set({ email: actor.context.user.email })
		.where(eq(users.id, actor.userId));
	return actor;
}

describe('ProfileService leave', () => {
	it('removes the ties, keeps the row, and returns the farewell data', async () => {
		const owner = await leaver('owner');
		const me = await leaver('leaver');
		const treeId = await createTestTree(t.db, owner);
		await addTestMember(t.db, treeId, me, 'editor');
		await t.db.insert(userSettings).values({ userId: me.userId, data: '{}' });
		await t.db.insert(personMarks).values({
			id: 'm1',
			userId: me.userId,
			treeId,
			personId: 'p',
			kind: 'favorite',
			touchedAt: 1
		});
		await t.db
			.insert(researchTasks)
			.values({ id: 'task1', treeId, title: 'x', assigneeId: me.userId });
		await t.db.insert(treeInvitations).values({
			id: 'inv1',
			treeId: await createTestTree(t.db, owner),
			email: me.context.user.email,
			role: 'viewer',
			expiresAt: new Date(Date.now() + 86_400_000)
		});
		await fake.put(`avatars/${me.userId}`, new Uint8Array([1]));
		await t.db
			.update(users)
			.set({ avatarKey: `avatars/${me.userId}` })
			.where(eq(users.id, me.userId));

		const farewell = await service.leave(
			` ${me.context.user.email.toUpperCase()} `,
			bucket,
			me.context
		);

		expect(farewell.to).toBe(me.context.user.email);
		expect(farewell.trees).toHaveLength(1);
		expect(farewell.trees[0]!.owners).toEqual([{ name: 'owner', email: owner.context.user.email }]);
		expect(
			await t.db.select().from(treeMemberships).where(eq(treeMemberships.userId, me.userId))
		).toEqual([]);
		expect(
			await t.db.select().from(userSettings).where(eq(userSettings.userId, me.userId))
		).toEqual([]);
		expect(await t.db.select().from(personMarks).where(eq(personMarks.userId, me.userId))).toEqual(
			[]
		);
		expect(await t.db.select().from(treeInvitations).where(eq(treeInvitations.id, 'inv1'))).toEqual(
			[]
		);
		const task = await t.db.select().from(researchTasks).where(eq(researchTasks.id, 'task1')).get();
		expect(task?.assigneeId).toBeNull();
		const row = await t.db.select().from(users).where(eq(users.id, me.userId)).get();
		expect(row?.avatarKey).toBeNull();
		expect(fake.objects.has(`avatars/${me.userId}`)).toBe(false);
	});

	it('leaves the person refused by admission, even with an invitation sent before', async () => {
		const owner = await leaver('o2');
		const me = await leaver('gone');
		const treeId = await createTestTree(t.db, owner);
		await addTestMember(t.db, treeId, me, 'viewer');
		await t.db.insert(treeInvitations).values({
			id: 'inv2',
			treeId: await createTestTree(t.db, owner),
			email: me.context.user.email,
			role: 'viewer',
			expiresAt: new Date(Date.now() + 86_400_000)
		});
		await service.leave(me.context.user.email, bucket, me.context);
		const admitted = await new UserRepository(t.db).admitFromAccess(
			{ accessSub: me.context.user.accessSub, email: me.context.user.email },
			null,
			new Date()
		);
		expect(admitted).toBeNull();
	});

	it('refuses a wrong address with a 400 and changes nothing', async () => {
		const me = await leaver('typo');
		const treeId = await createTestTree(t.db, await leaver('o3'));
		await addTestMember(t.db, treeId, me, 'viewer');
		await expect(service.leave('other@epoch.test', bucket, me.context)).rejects.toMatchObject({
			status: 400
		});
		expect(await new UserRepository(t.db).hasAnyMembership(me.userId)).toBe(true);
	});

	it('is blocked for the sole owner of a tree, but not when another owner exists', async () => {
		const me = await leaver('sole');
		const treeId = await createTestTree(t.db, me);
		await expect(service.leave(me.context.user.email, bucket, me.context)).rejects.toMatchObject({
			status: 409,
			details: { soleOwnerTrees: [{ id: treeId }] }
		});
		await addTestMember(t.db, treeId, await leaver('co-owner'), 'owner');
		await expect(service.leave(me.context.user.email, bucket, me.context)).resolves.toBeDefined();
	});

	it('is blocked for the install owner', async () => {
		const me = await leaver('install');
		const context: AuthenticatedContext = {
			...me.context,
			user: { ...me.context.user, isInstallOwner: true }
		};
		await expect(service.leave(me.context.user.email, bucket, context)).rejects.toMatchObject({
			status: 409,
			details: { isInstallOwner: true }
		});
		expect((await service.leaveBlockers(context)).isInstallOwner).toBe(true);
	});

	it('is not for the public visitor', async () => {
		const visitor: AuthenticatedContext = { user: PUBLIC_VISITOR, correlationId: 'v' };
		await expect(service.leave('', bucket, visitor)).rejects.toThrow('Forbidden');
	});
});
