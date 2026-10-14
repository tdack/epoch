import type { R2Bucket } from '@cloudflare/workers-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PayloadTooLargeError } from '../domain/errors';
import { MAX_TREE_MEDIA_BYTES } from '../../shared/media';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { FakeMediaBucket } from '../testing/fake-bucket';
import { canDeleteMedia, MediaService } from './media-service';

/** Lists two objects per page, so a tree's total only comes out right if every page is read. */
const PAGE_SIZE = 2;

/** An R2 listing with the given sizes; the bytes are never needed for the quota. */
function fakeListingBucket(sizes: Record<string, number>) {
	const bucket = new FakeMediaBucket(PAGE_SIZE);
	for (const [key, size] of Object.entries(sizes)) {
		bucket.objects.set(key, { body: new Uint8Array(0), size });
	}
	return bucket as unknown as R2Bucket;
}

let t: TestDatabase;
let treeId: string;
let otherTreeId: string;

beforeAll(async () => {
	t = await createTestDatabase();
	const owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, owner);
	otherTreeId = await createTestTree(t.db, owner);
}, 60_000);

afterAll(async () => {
	await t.dispose();
});

describe('MediaService.requireQuotaFor', () => {
	it('allows an upload that leaves the tree within its quota', async () => {
		const bucket = fakeListingBucket({ [`media/${treeId}/a/one.png`]: MAX_TREE_MEDIA_BYTES / 2 });
		await expect(
			new MediaService(t.db).requireQuotaFor(treeId, MAX_TREE_MEDIA_BYTES / 2, bucket)
		).resolves.toBeUndefined();
	});

	it('refuses an upload that would take the tree past its quota', async () => {
		const bucket = fakeListingBucket({
			[`media/${treeId}/a/one.png`]: MAX_TREE_MEDIA_BYTES - 10
		});
		await expect(new MediaService(t.db).requireQuotaFor(treeId, 11, bucket)).rejects.toBeInstanceOf(
			PayloadTooLargeError
		);
	});

	it('accepts an upload that exactly fills the quota', async () => {
		const bucket = fakeListingBucket({
			[`media/${treeId}/a/one.png`]: MAX_TREE_MEDIA_BYTES - 10
		});
		await expect(
			new MediaService(t.db).requireQuotaFor(treeId, 10, bucket)
		).resolves.toBeUndefined();
	});

	it('sums every page of the tree listing, not only the first', async () => {
		const bucket = fakeListingBucket({
			[`media/${treeId}/a/1.png`]: 1000,
			[`media/${treeId}/a/2.png`]: 1000,
			[`media/${treeId}/b/3.png`]: 1000,
			[`media/${treeId}/b/4.png`]: 1000,
			[`media/${treeId}/c/5.png`]: MAX_TREE_MEDIA_BYTES - 4001
		});
		const service = new MediaService(t.db);
		await expect(service.requireQuotaFor(treeId, 0, bucket)).resolves.toBeUndefined();
		await expect(service.requireQuotaFor(treeId, 2, bucket)).rejects.toBeInstanceOf(
			PayloadTooLargeError
		);
	});

	it('counts only this tree, so another tree filling up does not block this one', async () => {
		const bucket = fakeListingBucket({
			[`media/${otherTreeId}/a/one.png`]: MAX_TREE_MEDIA_BYTES
		});
		await expect(
			new MediaService(t.db).requireQuotaFor(treeId, 1024, bucket)
		).resolves.toBeUndefined();
	});
});

describe('canDeleteMedia', () => {
	const scope = (role: 'owner' | 'manager' | 'editor' | 'contributor' | 'viewer') => ({
		role,
		userId: 'me'
	});
	it('lets an editor delete the files they uploaded, and not other users', () => {
		expect(canDeleteMedia(scope('editor'), 'me')).toBe(true);
		expect(canDeleteMedia(scope('editor'), 'someone-else')).toBe(false);
	});
	it('lets a manager or owner delete any file, including one with no recorded uploader', () => {
		for (const role of ['manager', 'owner'] as const) {
			expect(canDeleteMedia(scope(role), 'someone-else')).toBe(true);
			expect(canDeleteMedia(scope(role), null)).toBe(true);
		}
	});
	it('refuses a contributor or viewer even for their own upload', () => {
		for (const role of ['contributor', 'viewer'] as const) {
			expect(canDeleteMedia(scope(role), 'me')).toBe(false);
		}
	});
	it('does not let an editor delete a legacy file with no uploader', () => {
		expect(canDeleteMedia(scope('editor'), null)).toBe(false);
	});
});
