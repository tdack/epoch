import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals } from '../db/schema';
import { createTestDatabase, createTestTree, createTestUser, type TestDatabase } from './d1';

describe('test database harness', () => {
	let testDb: TestDatabase;
	beforeAll(async () => {
		testDb = await createTestDatabase();
	});
	afterAll(async () => {
		await testDb.dispose();
	});

	it('applies every migration and enforces foreign keys', async () => {
		const { db } = testDb;
		const actor = await createTestUser(db);
		const treeId = await createTestTree(db, actor);
		await db.insert(individuals).values({ id: 'p1', treeId, givenName: 'Ada' });
		expect((await db.select().from(individuals).all()).length).toBe(1);
		await expect(
			db.insert(individuals).values({ id: 'p2', treeId: 'no-such-tree', givenName: 'Bad' })
		).rejects.toThrow();
	});
});
