import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changeLog, individuals } from '../db/schema';
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

	it('forbids two changes reverting the same change', async () => {
		const { db } = testDb;
		const actor = await createTestUser(db);
		const treeId = await createTestTree(db, actor);
		const row = (id: string, revertsChangeId: string | null) => ({
			id,
			treeId,
			actorId: actor.userId,
			kind: 'undo',
			summary: 's',
			changesJson: '[]',
			revertsChangeId
		});
		await db.insert(changeLog).values(row('c1', null));
		await db.insert(changeLog).values(row('c2', 'c1'));
		await db.insert(changeLog).values(row('c3', null));
		await expect(db.insert(changeLog).values(row('c4', 'c1'))).rejects.toThrow();
	});
});
