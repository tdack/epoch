/**
 * Deleting a tree (TreeService.deleteTree) over a real database and the fake bucket: the rows go
 * first, the tree's own objects go with them, and no other tree's objects are touched.
 */

import type { R2Bucket } from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { trees } from '../db/schema';
import { UnauthorizedError } from '../domain/errors';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { FakeMediaBucket } from '../testing/fake-bucket';
import { TreeService } from './tree-service';

let t: TestDatabase;
let owner: TestActor;
let editor: TestActor;
beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	editor = await createTestUser(t.db, 'editor');
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

/** A tree with a file, a queued import and a neighbour's objects under look-alike prefixes. */
async function seededTree(bucket: FakeMediaBucket) {
	const treeId = await createTestTree(t.db, owner);
	const otherTreeId = await createTestTree(t.db, owner);
	await addTestMember(t.db, treeId, editor, 'editor');
	const keys = [
		`media/${treeId}/file.png`,
		`media/${treeId}/legacy-entity/old.png`,
		`staging/gedcom-${treeId}-1700000000000-abc.ged`
	];
	const kept = [
		`media/${treeId}x/not-ours.png`,
		`media/${otherTreeId}/theirs.png`,
		`staging/gedcom-${otherTreeId}-1700000000000-def.ged`,
		`staging/gedcom-${treeId}-notes.txt`
	];
	for (const key of [...keys, ...kept]) await bucket.put(key, new Uint8Array([1]));
	return { treeId, keys, kept };
}

const remaining = (bucket: FakeMediaBucket) => [...bucket.objects.keys()].sort();

describe('deleting a tree and its stored files', () => {
	it('removes the tree rows and every object under its prefixes, and nothing else', async () => {
		const bucket = new FakeMediaBucket();
		const { treeId, kept } = await seededTree(bucket);

		await new TreeService(t.db).deleteTree(treeId, owner.context, bucket as unknown as R2Bucket);

		expect(await t.db.select().from(trees).where(eq(trees.id, treeId))).toEqual([]);
		expect(remaining(bucket)).toEqual([...kept].sort());
	});

	it('deletes the rows before it lists or deletes any object', async () => {
		const bucket = new FakeMediaBucket();
		const { treeId } = await seededTree(bucket);
		let isRowGoneWhenSwept: boolean | null = null;
		const list = bucket.list.bind(bucket);
		bucket.list = async (options) => {
			isRowGoneWhenSwept =
				(await t.db.select().from(trees).where(eq(trees.id, treeId))).length === 0;
			return list(options);
		};

		await new TreeService(t.db).deleteTree(treeId, owner.context, bucket as unknown as R2Bucket);
		expect(isRowGoneWhenSwept).toBe(true);
	});

	it('deletes in batches of at most 1,000 keys, across listing pages', async () => {
		const bucket = new FakeMediaBucket(7);
		const treeId = await createTestTree(t.db, owner);
		for (let i = 0; i < 2_503; i++) {
			bucket.objects.set(`media/${treeId}/bulk/${i}.png`, { body: new Uint8Array(0), size: 1 });
		}
		bucket.objects.set(`staging/gedcom-${treeId}-bulk.ged`, { body: new Uint8Array(0), size: 1 });

		await new TreeService(t.db).deleteTree(treeId, owner.context, bucket as unknown as R2Bucket);

		expect(bucket.objects.size).toBe(0);
		expect(bucket.deleteBatches.length).toBeGreaterThan(1);
		expect(Math.max(...bucket.deleteBatches)).toBeLessThanOrEqual(1000);
	});

	it('still deletes the tree when the sweep fails, and says so in the log', async () => {
		const treeId = await createTestTree(t.db, owner);
		const broken = {
			list: () => Promise.reject(new Error('R2 unavailable')),
			delete: () => Promise.reject(new Error('R2 unavailable'))
		} as unknown as R2Bucket;
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(
			new TreeService(t.db).deleteTree(treeId, owner.context, broken)
		).resolves.toBeUndefined();

		expect(await t.db.select().from(trees).where(eq(trees.id, treeId))).toEqual([]);
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining('left stored files behind'),
			expect.objectContaining({ treeId })
		);
		log.mockRestore();
	});

	it('is the owner alone who may delete, and a refused delete touches no object', async () => {
		const bucket = new FakeMediaBucket();
		const { treeId, keys, kept } = await seededTree(bucket);
		const before = remaining(bucket);

		await expect(
			new TreeService(t.db).deleteTree(treeId, editor.context, bucket as unknown as R2Bucket)
		).rejects.toBeInstanceOf(UnauthorizedError);

		expect(remaining(bucket)).toEqual(before);
		expect(before).toEqual([...keys, ...kept].sort());
		expect(await t.db.select().from(trees).where(eq(trees.id, treeId))).toHaveLength(1);
	});
});
