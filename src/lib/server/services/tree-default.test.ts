import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { R2Bucket } from '@cloudflare/workers-types';
import { trees } from '../db/schema';
import { TreeRepository } from '../repositories/tree-repository';
import { addTestMember, createTestDatabase, createTestTree, createTestUser } from '../testing/d1';
import type { TestDatabase } from '../testing/d1';
import { TreeService } from './tree-service';
import { FakeMediaBucket } from '../testing/fake-bucket';

type Actor = Awaited<ReturnType<typeof createTestUser>>;
let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const service = () => new TreeService(t.db);
const defaultsOf = async (user: Actor) =>
	(await new TreeRepository(t.db).listForUser(user.context.user.id))
		.filter((tree) => tree.isDefault)
		.map((tree) => tree.id);

describe('default tree', () => {
	it('starts unset, then holds exactly one tree per user', async () => {
		const user = await createTestUser(t.db);
		const first = await createTestTree(t.db, user);
		const second = await createTestTree(t.db, user);
		expect(await defaultsOf(user)).toEqual([]);

		await service().setDefaultTree(first, user.context);
		expect(await defaultsOf(user)).toEqual([first]);
		await service().setDefaultTree(second, user.context);
		expect(await defaultsOf(user)).toEqual([second]);
		await service().setDefaultTree(null, user.context);
		expect(await defaultsOf(user)).toEqual([]);
	});

	it('is each member’s own', async () => {
		const owner = await createTestUser(t.db);
		const treeId = await createTestTree(t.db, owner);
		const viewer = await createTestUser(t.db);
		await addTestMember(t.db, treeId, viewer, 'viewer');

		await service().setDefaultTree(treeId, viewer.context);
		expect(await defaultsOf(viewer)).toEqual([treeId]);
		expect(await defaultsOf(owner)).toEqual([]);
	});

	it('refuses a tree the user cannot see', async () => {
		const owner = await createTestUser(t.db);
		const treeId = await createTestTree(t.db, owner);
		const stranger = await createTestUser(t.db);
		await expect(service().setDefaultTree(treeId, stranger.context)).rejects.toThrow();
		expect(await defaultsOf(stranger)).toEqual([]);
	});

	it('keeps the current default when a non-member picks the public tree', async () => {
		const reader = await createTestUser(t.db);
		const own = await createTestTree(t.db, reader);
		await service().setDefaultTree(own, reader.context);
		const publisher = await createTestUser(t.db);
		const publicTree = await createTestTree(t.db, publisher);
		await t.db.update(trees).set({ isPublic: true }).where(eq(trees.id, publicTree));
		try {
			// Readable as a viewer (ADR-041), but there is no membership to carry the flag.
			await expect(service().setDefaultTree(publicTree, reader.context)).rejects.toThrow('member');
			expect(await defaultsOf(reader)).toEqual([own]);
		} finally {
			await t.db.update(trees).set({ isPublic: false }).where(eq(trees.id, publicTree));
		}
	});

	it('goes with the tree when it is deleted', async () => {
		const user = await createTestUser(t.db);
		const kept = await createTestTree(t.db, user);
		const doomed = await createTestTree(t.db, user);
		await service().setDefaultTree(doomed, user.context);
		await service().deleteTree(doomed, user.context, new FakeMediaBucket() as unknown as R2Bucket);
		expect(await defaultsOf(user)).toEqual([]);
		// Nothing left behind blocks choosing again.
		await service().setDefaultTree(kept, user.context);
		expect(await defaultsOf(user)).toEqual([kept]);
	});
});
